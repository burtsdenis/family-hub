import { createReadStream } from 'node:fs';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { createWriteStream } from 'node:fs';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { db, id, now, today } from '../db/index.js';
import { paths } from '../env.js';

/** Потолок на файл. Больше — это уже не заметка, а файловое хранилище. */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

/** Бюджет хранилища: до него — предупреждаем в UI, после — отказываем. */
const BUDGET_BYTES = 2 * 1024 * 1024 * 1024;

const IMAGE_MIME = /^image\/(png|jpeg|gif|webp|avif|heic|svg\+xml)$/;

/*
  Отдавать inline можно только растровые форматы. SVG — это документ со
  скриптами: открытый напрямую по /api/attachments/:id, он исполнился бы
  с origin хаба. CSP script-src 'self' это уже глушит, но защита не должна
  держаться на одном слое. В <img> заметок SVG продолжает показываться —
  картинкам заголовок Content-Disposition безразличен.
*/
const INLINE_MIME = /^image\/(png|jpeg|gif|webp|avif|heic)$/;

/** MIME приходит от клиента: что не похоже на MIME — становится octet-stream. */
function safeMime(mime: string): string {
  return /^[\w.+-]{1,80}\/[\w.+-]{1,80}$/.test(mime) ? mime : 'application/octet-stream';
}

interface AttachmentRow {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  storage_path: string;
  note_id: string | null;
  task_id: string | null;
  transaction_id: string | null;
}

/**
 * Имя файла от человека не участвует в пути на диске никогда.
 * Файл кладётся под сгенерированным именем, а исходное имя живёт в базе —
 * иначе «../../» в имени увело бы запись куда угодно.
 */
function storageNameFor(originalName: string): string {
  const ext = extname(originalName).toLowerCase().replace(/[^.a-z0-9]/g, '');
  return `${id()}${ext.slice(0, 12)}`;
}

/** Заголовок для отдачи: имя может быть на любом языке. */
function contentDisposition(filename: string, inline: boolean): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
  return `${inline ? 'inline' : 'attachment'}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}

/** Вложение видно тем же, кому видна заметка, к которой оно приложено. */
function loadVisible(attachmentId: string, userId: string): AttachmentRow | null {
  const row = db
    .prepare(
      `SELECT a.* FROM attachments a
         LEFT JOIN notes n ON n.id = a.note_id
         LEFT JOIN transactions t ON t.id = a.transaction_id
         LEFT JOIN accounts acc ON acc.id = t.account_id
        WHERE a.id = ?
          AND (a.note_id IS NULL OR n.visibility = 'shared' OR n.owner_id = ?)
          AND (a.transaction_id IS NULL OR acc.shared = 1 OR acc.owner_id = ?)`,
    )
    .get(attachmentId, userId, userId) as AttachmentRow | undefined;
  return row ?? null;
}

interface UploadedInfo {
  id: string;
  filename: string;
  mime: string;
  size_bytes: number;
  is_image: boolean;
  url: string;
}

/**
 * Приём файлов одним куском: либо сохранились все, либо ни один.
 *
 * Раньше превышение лимита на втором файле возвращало 413, но первый уже
 * лежал на диске и в базе — клиент видел ошибку, а половина вложений тихо
 * прикреплялась. Теперь при отказе откатываются и записи, и файлы.
 */
async function receiveFiles(
  req: FastifyRequest,
  reply: FastifyReply,
  target: { note_id: string | null; transaction_id: string | null },
): Promise<UploadedInfo[] | null> {
  const uploaded: UploadedInfo[] = [];
  const savedPaths: string[] = [];

  const rollback = async (): Promise<void> => {
    if (uploaded.length > 0) {
      db.prepare(
        `DELETE FROM attachments WHERE id IN (${uploaded.map(() => '?').join(',')})`,
      ).run(...uploaded.map((u) => u.id));
    }
    for (const path of savedPaths) await unlink(path).catch(() => {});
  };

  // Бюджет проверяется на входе: уже принятое не отзываем, но следующий
  // запрос поверх переполненного хранилища получает отказ, а не диск до дна
  const { used } = db
    .prepare('SELECT coalesce(sum(size_bytes), 0) AS used FROM attachments')
    .get() as { used: number };
  if (used >= BUDGET_BYTES) {
    await reply.code(413).send({ error: 'Хранилище вложений заполнено' });
    return null;
  }

  for await (const part of req.files()) {
    const storageName = storageNameFor(part.filename);
    // Папка месяца — по местным часам, как и всё остальное в приложении
    const month = today().slice(0, 7);
    const folder = join(paths.attachments, month);
    await mkdir(folder, { recursive: true });
    const fullPath = join(folder, storageName);

    await pipeline(part.file, createWriteStream(fullPath));

    // Превышение лимита multipart обрубает поток, а не бросает исключение
    if (part.file.truncated) {
      await unlink(fullPath).catch(() => {});
      await rollback();
      await reply
        .code(413)
        .send({ error: `Файл больше ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} МБ` });
      return null;
    }

    const { size } = await stat(fullPath);
    const attachmentId = id();
    db.prepare(
      `INSERT INTO attachments (id, filename, mime, size_bytes, storage_path, note_id,
                                transaction_id, uploaded_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      attachmentId,
      part.filename,
      safeMime(part.mimetype),
      size,
      // В базе только относительный путь: каталог данных может переехать
      join(month, storageName),
      target.note_id,
      target.transaction_id,
      (req.user?.id ?? '') || null,
      now(),
    );

    savedPaths.push(fullPath);
    uploaded.push({
      id: attachmentId,
      filename: part.filename,
      mime: safeMime(part.mimetype),
      size_bytes: size,
      is_image: IMAGE_MIME.test(part.mimetype),
      url: `/api/attachments/${attachmentId}`,
    });
  }

  if (uploaded.length === 0) {
    await reply.code(400).send({ error: 'Файл не пришёл' });
    return null;
  }
  return uploaded;
}

export async function registerAttachmentRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/attachments/usage', () => {
    const row = db
      .prepare('SELECT coalesce(sum(size_bytes), 0) AS used, count(*) AS files FROM attachments')
      .get() as { used: number; files: number };
    return {
      used: row.used,
      files: row.files,
      budget: BUDGET_BYTES,
      max_file: MAX_FILE_BYTES,
    };
  });

  app.post('/api/notes/:id/attachments', async (req, reply) => {
    const { id: noteId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = req.user?.id ?? '';

    const note = db
      .prepare(
        `SELECT id FROM notes
          WHERE id = ? AND (visibility = 'shared' OR owner_id = ?)`,
      )
      .get(noteId, userId);
    if (!note) return reply.code(404).send({ error: 'Заметка не найдена' });

    const uploaded = await receiveFiles(req, reply, { note_id: noteId, transaction_id: null });
    if (!uploaded) return;
    return reply.code(201).send({ uploaded });
  });

  app.post('/api/transactions/:id/attachments', async (req, reply) => {
    const { id: txId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const userId = req.user?.id ?? '';

    const tx = db
      .prepare(
        `SELECT t.id FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE t.id = ? AND (a.shared = 1 OR a.owner_id = ?)`,
      )
      .get(txId, userId);
    if (!tx) return reply.code(404).send({ error: 'Операция не найдена' });

    const uploaded = await receiveFiles(req, reply, { note_id: null, transaction_id: txId });
    if (!uploaded) return;
    return reply.code(201).send({ uploaded });
  });

  app.get('/api/attachments/:id', async (req, reply) => {
    const { id: attachmentId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { download } = z.object({ download: z.string().optional() }).parse(req.query);

    const attachment = loadVisible(attachmentId, req.user?.id ?? '');
    if (!attachment) return reply.code(404).send({ error: 'Файл не найден' });

    const fullPath = resolve(paths.attachments, attachment.storage_path);
    // Страховка от выхода за пределы каталога вложений
    if (!fullPath.startsWith(resolve(paths.attachments))) {
      return reply.code(400).send({ error: 'Некорректный путь' });
    }

    try {
      await stat(fullPath);
    } catch {
      return reply.code(404).send({ error: 'Файл потерян на диске' });
    }

    const inline = download !== 'true' && INLINE_MIME.test(attachment.mime);
    return reply
      .header('Content-Type', safeMime(attachment.mime))
      .header('Content-Disposition', contentDisposition(attachment.filename, inline))
      // Содержимое по идентификатору неизменно, можно кэшировать надолго
      .header('Cache-Control', 'private, max-age=31536000, immutable')
      .send(createReadStream(fullPath));
  });

  app.delete('/api/attachments/:id', async (req, reply) => {
    const { id: attachmentId } = z.object({ id: z.string().uuid() }).parse(req.params);

    const attachment = loadVisible(attachmentId, req.user?.id ?? '');
    if (!attachment) return reply.code(404).send({ error: 'Файл не найден' });

    db.prepare('DELETE FROM attachments WHERE id = ?').run(attachmentId);
    // Запись удалена в любом случае; отсутствующий на диске файл не повод падать
    await unlink(resolve(paths.attachments, attachment.storage_path)).catch(() => {});

    return { ok: true };
  });
}
