import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db, id, now, today } from '../db/index.js';
import { paths } from '../env.js';

interface NoteRow {
  id: string;
  title: string;
  body_md: string;
  folder_id: string | null;
  visibility: 'shared' | 'private';
  owner_id: string | null;
  is_template: number;
  daily_date: string | null;
  pinned: number;
  created_at: string;
  updated_at: string;
}

/**
 * Приватную заметку видит только владелец.
 * Роль здесь не участвует: администратор — служебная учётка для управления
 * системой, а не суперпользователь над содержимым. См. раздел о ролях в ТЗ.
 */
const VISIBLE = "(n.visibility = 'shared' OR n.owner_id = ?)";

function loadVisible(noteId: string, userId: string): NoteRow | null {
  const row = db
    .prepare(`SELECT n.* FROM notes n WHERE n.id = ? AND ${VISIBLE}`)
    .get(noteId, userId) as NoteRow | undefined;
  return row ?? null;
}

/** Менять заметку может любой домочадец, кроме чужих приватных. */
function guard(
  noteId: string,
  req: FastifyRequest,
  reply: FastifyReply,
): NoteRow | null {
  const note = loadVisible(noteId, req.user?.id ?? '');
  if (!note) {
    reply.code(404).send({ error: 'Заметка не найдена' });
    return null;
  }
  return note;
}

// ── Ссылки [[Заголовок]] ──────────────────────────────────────────────────

const WIKI_LINK = /\[\[([^\][|]{1,200})\]\]/g;
const ESCAPED_WIKI_LINK = /\\\[\\\[([^\][|]{1,200})\\\]\\\]/g;

/**
 * Редакторы markdown любят экранировать квадратные скобки. Приводим ссылки
 * к каноничному виду до того, как текст попадёт в базу: иначе заметка
 * читается глазами нормально, а связь между заметками теряется.
 */
export function normalizeWikiLinks(body: string): string {
  return body.replace(ESCAPED_WIKI_LINK, '[[$1]]');
}

export function extractLinks(body: string): string[] {
  const titles = new Set<string>();
  for (const match of body.matchAll(WIKI_LINK)) {
    const title = match[1]?.trim();
    if (title) titles.add(title);
  }
  return [...titles];
}

/**
 * Перестраивает исходящие ссылки заметки.
 * Ссылка на ещё не созданную заметку сохраняется с пустой целью — когда
 * заметка с таким заголовком появится, связь подхватится автоматически.
 */
function rebuildLinks(noteId: string, body: string): void {
  db.prepare('DELETE FROM note_links WHERE source_note_id = ?').run(noteId);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO note_links (source_note_id, target_note_id, target_title)
     VALUES (?, (SELECT id FROM notes WHERE lower(title) = lower(?) LIMIT 1), ?)`,
  );
  for (const title of extractLinks(body)) insert.run(noteId, title, title);
}

/** Подтягивает висящие ссылки на заметку с таким заголовком. */
function resolveIncoming(noteId: string, title: string): void {
  db.prepare(
    `UPDATE note_links SET target_note_id = ?
      WHERE target_note_id IS NULL AND lower(target_title) = lower(?)`,
  ).run(noteId, title);
}

/**
 * Подстановки в шаблоне. Раскрываются один раз, в момент создания заметки:
 * дальше это обычный текст, который можно править. Живых, пересчитываемых
 * значений здесь сознательно нет — заметка должна означать одно и то же
 * и через год.
 */
export function applyPlaceholders(text: string, authorName: string): string {
  const date = new Date();
  const values: Record<string, string> = {
    дата: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(date),
    date: new Intl.DateTimeFormat('ru-RU', { dateStyle: 'long' }).format(date),
    // По местным часам, как {{дата}} и {{время}}: toISOString() дал бы
    // дату по Гринвичу, и заметка, созданная в 00:30, помечалась бы вчерашним днём
    изо: today(),
    iso: today(),
    время: new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(date),
    time: new Intl.DateTimeFormat('ru-RU', { timeStyle: 'short' }).format(date),
    автор: authorName,
    author: authorName,
  };

  return text.replace(/\{\{\s*([\wа-яёА-ЯЁ_]+)\s*\}\}/gu, (match, rawKey: string) => {
    const key = rawKey.toLowerCase();
    return values[key] ?? match;
  });
}

// ── История версий ────────────────────────────────────────────────────────

const VERSION_GAP_MINUTES = 10;

/**
 * Снимок предыдущего содержимого — но не на каждое сохранение.
 * Автосохранение срабатывает раз в пару секунд, и без этого условия
 * история за один вечер работы превратилась бы в тысячу бесполезных строк.
 */
function snapshotIfNeeded(note: NoteRow, authorId: string): void {
  const last = db
    .prepare(
      `SELECT author_id, created_at FROM note_versions
        WHERE note_id = ? ORDER BY created_at DESC LIMIT 1`,
    )
    .get(note.id) as { author_id: string | null; created_at: string } | undefined;

  const stale =
    !last ||
    last.author_id !== authorId ||
    Date.now() - new Date(`${last.created_at.replace(' ', 'T')}Z`).getTime() >
      VERSION_GAP_MINUTES * 60_000;

  if (!stale) return;

  db.prepare(
    `INSERT INTO note_versions (id, note_id, title, body_md, author_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id(), note.id, note.title, note.body_md, authorId, now());
}

// ── Схемы ─────────────────────────────────────────────────────────────────

const createInput = z.object({
  title: z.string().max(200).optional(),
  body_md: z.string().max(500_000).optional(),
  folder_id: z.string().uuid().nullable().optional(),
  visibility: z.enum(['shared', 'private']).optional(),
  template_id: z.string().uuid().optional(),
  is_template: z.boolean().optional(),
  daily_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

const patchInput = z.object({
  title: z.string().min(1, 'У заметки должен быть заголовок').max(200).optional(),
  body_md: z.string().max(500_000).optional(),
  folder_id: z.string().uuid().nullable().optional(),
  visibility: z.enum(['shared', 'private']).optional(),
  pinned: z.boolean().optional(),
  is_template: z.boolean().optional(),
});

export async function registerNoteRoutes(app: FastifyInstance): Promise<void> {
  // ── Папки ───────────────────────────────────────────────────────────────

  app.get('/api/folders', () =>
    db.prepare('SELECT * FROM folders ORDER BY position, name').all(),
  );

  app.post('/api/folders', (req, reply) => {
    const parsed = z
      .object({
        name: z.string().min(1, 'Укажите название папки').max(100),
        parent_id: z.string().uuid().nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const folderId = id();
    db.prepare(
      `INSERT INTO folders (id, parent_id, name, position)
       VALUES (?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM folders))`,
    ).run(folderId, parsed.data.parent_id ?? null, parsed.data.name.trim());
    return reply.code(201).send(db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId));
  });

  app.patch('/api/folders/:id', (req, reply) => {
    const { id: folderId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({ name: z.string().min(1).max(100) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите название папки' });

    const result = db
      .prepare('UPDATE folders SET name = ? WHERE id = ?')
      .run(parsed.data.name.trim(), folderId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Папка не найдена' });
    return db.prepare('SELECT * FROM folders WHERE id = ?').get(folderId);
  });

  app.delete('/api/folders/:id', (req, reply) => {
    const { id: folderId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const count = (
      db.prepare('SELECT count(*) AS n FROM notes WHERE folder_id = ?').get(folderId) as {
        n: number;
      }
    ).n;
    if (count > 0) {
      return reply
        .code(409)
        .send({
          error:
            `В папке ${count} ` +
            (count % 10 === 1 && count % 100 !== 11 ? 'заметка' : 'заметок') +
            '. Сначала перенесите содержимое в другое место',
        });
    }
    db.prepare('DELETE FROM folders WHERE id = ?').run(folderId);
    return { ok: true };
  });

  // ── Список заметок ──────────────────────────────────────────────────────

  app.get('/api/notes', (req) => {
    const q = z
      .object({
        folder_id: z.string().optional(),
        templates: z.enum(['true', 'false']).optional(),
        q: z.string().max(200).optional(),
      })
      .parse(req.query);

    const userId = req.user?.id ?? '';
    const where = [VISIBLE, 'n.is_template = ?'];
    const args: unknown[] = [userId, q.templates === 'true' ? 1 : 0];

    if (q.folder_id === 'none') {
      where.push('n.folder_id IS NULL');
    } else if (q.folder_id) {
      where.push('n.folder_id = ?');
      args.push(q.folder_id);
    }
    if (q.q) {
      where.push('(ci_contains(n.title, ?) OR ci_contains(n.body_md, ?))');
      args.push(q.q, q.q);
    }

    return db
      .prepare(
        `SELECT n.id, n.title, n.folder_id, n.visibility, n.owner_id, n.pinned,
                n.daily_date, n.is_template, n.updated_at, u.name AS owner_name,
                substr(replace(replace(n.body_md, '#', ''), char(10), ' '), 1, 120) AS excerpt
           FROM notes n
           LEFT JOIN users u ON u.id = n.owner_id
          WHERE ${where.join(' AND ')}
          ORDER BY n.pinned DESC, n.updated_at DESC`,
      )
      .all(...args);
  });

  // ── Одна заметка со связями ─────────────────────────────────────────────

  app.get('/api/notes/:id', (req, reply) => {
    const { id: noteId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const note = guard(noteId, req, reply);
    if (!note) return;

    const userId = req.user?.id ?? '';

    const outgoing = db
      .prepare(
        `SELECT l.target_title, l.target_note_id,
                CASE WHEN n.id IS NULL THEN 0 ELSE 1 END AS exists_now
           FROM note_links l
           LEFT JOIN notes n ON n.id = l.target_note_id
            AND (n.visibility = 'shared' OR n.owner_id = ?)
          WHERE l.source_note_id = ?
          ORDER BY l.target_title`,
      )
      .all(userId, noteId);

    const backlinks = db
      .prepare(
        `SELECT n.id, n.title FROM note_links l
           JOIN notes n ON n.id = l.source_note_id
          WHERE l.target_note_id = ? AND (n.visibility = 'shared' OR n.owner_id = ?)
          ORDER BY n.title`,
      )
      .all(noteId, userId);

    const attachments = db
      .prepare(
        `SELECT id, filename, mime, size_bytes, created_at,
                CASE WHEN mime LIKE 'image/%' THEN 1 ELSE 0 END AS is_image
           FROM attachments
          WHERE note_id = ?
          ORDER BY created_at`,
      )
      .all(noteId);

    return { ...note, outgoing, backlinks, attachments };
  });

  // ── Создание ────────────────────────────────────────────────────────────

  app.post('/api/notes', (req, reply) => {
    const parsed = createInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const d = parsed.data;
    const userId = req.user?.id ?? null;

    const authorName =
      (
        db.prepare('SELECT name FROM users WHERE id = ?').get(userId ?? '') as
          | { name: string }
          | undefined
      )?.name ?? '';

    let body = normalizeWikiLinks(d.body_md ?? '');
    let titleFromTemplate: string | null = null;

    if (d.template_id) {
      // Шаблон подчиняется той же видимости, что и обычная заметка:
      // чужой приватный шаблон нельзя развернуть, даже зная его идентификатор
      const template = db
        .prepare(
          `SELECT title, body_md FROM notes
            WHERE id = ? AND is_template = 1
              AND (visibility = 'shared' OR owner_id = ?)`,
        )
        .get(d.template_id, userId ?? '') as { title: string; body_md: string } | undefined;
      if (!template) return reply.code(400).send({ error: 'Шаблон не найден' });
      body = applyPlaceholders(template.body_md, authorName);
      titleFromTemplate = applyPlaceholders(template.title, authorName);
    }

    if (d.daily_date) {
      const existing = db.prepare('SELECT * FROM notes WHERE daily_date = ?').get(d.daily_date) as
        | NoteRow
        | undefined;
      if (existing) {
        // Чужая приватная заметка дня не отдаётся — как и в GET /api/notes/daily.
        // Вторую на ту же дату не создать (daily_date уникальна), поэтому 409.
        if (existing.visibility === 'private' && existing.owner_id !== userId) {
          return reply
            .code(409)
            .send({ error: 'Заметка на эту дату уже есть, и она приватная' });
        }
        return reply.code(200).send(existing);
      }
    }

    const noteId = id();
    const title =
      d.title?.trim() || titleFromTemplate || d.daily_date || 'Без названия';

    db.prepare(
      `INSERT INTO notes (id, title, body_md, folder_id, visibility, owner_id, daily_date,
                          is_template, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      noteId,
      title,
      body,
      d.folder_id ?? null,
      d.visibility ?? 'shared',
      userId,
      d.daily_date ?? null,
      d.is_template ? 1 : 0,
      now(),
      now(),
    );

    rebuildLinks(noteId, body);
    resolveIncoming(noteId, title);

    return reply.code(201).send(db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId));
  });

  // ── Изменение ───────────────────────────────────────────────────────────

  app.patch('/api/notes/:id', (req, reply) => {
    const { id: noteId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const note = guard(noteId, req, reply);
    if (!note) return;

    const parsed = patchInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const d = parsed.data;
    const userId = req.user?.id ?? '';

    // Сделать заметку приватной может только тот, кто станет её владельцем
    if (d.visibility === 'private' && note.owner_id && note.owner_id !== userId) {
      return reply.code(403).send({ error: 'Приватной заметку делает её владелец' });
    }

    const contentChanged =
      (d.title !== undefined && d.title !== note.title) ||
      (d.body_md !== undefined && normalizeWikiLinks(d.body_md) !== note.body_md);

    const run = db.transaction(() => {
      if (contentChanged) snapshotIfNeeded(note, userId);

      const fields: [string, unknown][] = [];
      if (d.title !== undefined) fields.push(['title', d.title.trim()]);
      if (d.body_md !== undefined) fields.push(['body_md', normalizeWikiLinks(d.body_md)]);
      if (d.folder_id !== undefined) fields.push(['folder_id', d.folder_id]);
      if (d.pinned !== undefined) fields.push(['pinned', d.pinned ? 1 : 0]);
      if (d.is_template !== undefined) fields.push(['is_template', d.is_template ? 1 : 0]);
      if (d.visibility !== undefined) {
        fields.push(['visibility', d.visibility]);
        // Приватная заметка обязана иметь владельца, иначе её не увидит никто
        if (d.visibility === 'private' && !note.owner_id) fields.push(['owner_id', userId]);
      }

      if (fields.length > 0) {
        const set = fields.map(([k]) => `${k} = ?`).join(', ');
        db.prepare(`UPDATE notes SET ${set}, updated_at = ? WHERE id = ?`).run(
          ...fields.map(([, v]) => v as string | number | null),
          now(),
          noteId,
        );
      }

      if (d.body_md !== undefined) rebuildLinks(noteId, normalizeWikiLinks(d.body_md));
      if (d.title !== undefined) resolveIncoming(noteId, d.title.trim());
    });
    run();

    return db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
  });

  app.delete('/api/notes/:id', async (req, reply) => {
    const { id: noteId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const note = guard(noteId, req, reply);
    if (!note) return;

    // Строки в базе уйдут каскадом, но файлы на диске нужно убрать руками,
    // иначе каталог вложений будет расти вечно.
    const files = db
      .prepare('SELECT storage_path FROM attachments WHERE note_id = ?')
      .all(noteId) as { storage_path: string }[];

    db.prepare('DELETE FROM notes WHERE id = ?').run(noteId);

    for (const file of files) {
      await unlink(resolve(paths.attachments, file.storage_path)).catch(() => {});
    }
    return { ok: true };
  });

  // ── История ─────────────────────────────────────────────────────────────

  app.get('/api/notes/:id/versions', (req, reply) => {
    const { id: noteId } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!guard(noteId, req, reply)) return;

    return db
      .prepare(
        `SELECT v.id, v.title, v.created_at, u.name AS author_name,
                length(v.body_md) AS size
           FROM note_versions v
           LEFT JOIN users u ON u.id = v.author_id
          WHERE v.note_id = ?
          ORDER BY v.created_at DESC
          LIMIT 50`,
      )
      .all(noteId);
  });

  app.get('/api/notes/:id/versions/:versionId', (req, reply) => {
    const { id: noteId, versionId } = z
      .object({ id: z.string().uuid(), versionId: z.string().uuid() })
      .parse(req.params);
    if (!guard(noteId, req, reply)) return;

    const version = db
      .prepare('SELECT * FROM note_versions WHERE id = ? AND note_id = ?')
      .get(versionId, noteId);
    if (!version) return reply.code(404).send({ error: 'Версия не найдена' });
    return version;
  });

  app.post('/api/notes/:id/restore/:versionId', (req, reply) => {
    const { id: noteId, versionId } = z
      .object({ id: z.string().uuid(), versionId: z.string().uuid() })
      .parse(req.params);
    const note = guard(noteId, req, reply);
    if (!note) return;

    const version = db
      .prepare('SELECT title, body_md FROM note_versions WHERE id = ? AND note_id = ?')
      .get(versionId, noteId) as { title: string; body_md: string } | undefined;
    if (!version) return reply.code(404).send({ error: 'Версия не найдена' });

    const userId = req.user?.id ?? '';
    const run = db.transaction(() => {
      // Текущее состояние сохраняем всегда: откат тоже должен быть обратим
      db.prepare(
        `INSERT INTO note_versions (id, note_id, title, body_md, author_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id(), noteId, note.title, note.body_md, userId, now());

      db.prepare('UPDATE notes SET title = ?, body_md = ?, updated_at = ? WHERE id = ?').run(
        version.title,
        version.body_md,
        now(),
        noteId,
      );
      rebuildLinks(noteId, version.body_md);
    });
    run();

    return db.prepare('SELECT * FROM notes WHERE id = ?').get(noteId);
  });

  // ── Заметка дня ─────────────────────────────────────────────────────────

  app.get('/api/notes/daily/:date', (req, reply) => {
    const { date } = z
      .object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })
      .parse(req.params);

    const existing = db.prepare('SELECT * FROM notes WHERE daily_date = ?').get(date) as
      | NoteRow
      | undefined;
    if (existing) {
      if (existing.visibility === 'private' && existing.owner_id !== req.user?.id) {
        return reply.code(404).send({ error: 'Заметка не найдена' });
      }
      return existing;
    }
    return reply.code(404).send({ error: 'На эту дату заметки ещё нет' });
  });
}
