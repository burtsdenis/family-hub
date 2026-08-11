import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { db, id, now } from '../db/index.js';
import { paths } from '../env.js';

function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Счёт виден, если он общий или принадлежит спрашивающему.
 * Дальше на этом правиле держится вся приватность денег: у операции
 * отдельного признака приватности нет — она наследует его от счёта.
 */
const ACCOUNT_VISIBLE = '(a.shared = 1 OR a.owner_id = ?)';

const accountInput = z.object({
  name: z.string().min(1, 'Укажите название счёта').max(100),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/, 'Код валюты — три заглавные буквы, например RSD или EUR'),
  kind: z.enum(['cash', 'card', 'savings']).optional(),
  opening_balance: z.number().int().optional(),
  shared: z.boolean().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
});

const categoryInput = z.object({
  name: z.string().min(1, 'Укажите название категории').max(100),
  kind: z.enum(['expense', 'income']),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  parent_id: z.string().uuid().nullable().optional(),
});

/**
 * Родитель обязан быть существующей категорией того же вида и сам быть
 * верхнего уровня — глубже одного уровня иерархия не растёт.
 * Возвращает текст ошибки или null, если всё в порядке.
 */
function parentProblem(parentId: string, kind: string): string | null {
  const parent = db
    .prepare('SELECT kind, parent_id, archived_at FROM categories WHERE id = ?')
    .get(parentId) as { kind: string; parent_id: string | null; archived_at: string | null } | undefined;
  if (!parent || parent.archived_at) return 'Родительская категория не найдена';
  if (parent.kind !== kind) return 'Родитель должен быть категорией того же вида';
  if (parent.parent_id) return 'Подкатегория не может быть родителем';
  return null;
}

const txBase = z.object({
  kind: z.enum(['expense', 'income', 'transfer']),
  occurred_on: z.string().regex(DATE, 'Дата в формате ГГГГ-ММ-ДД'),
  account_id: z.string().uuid(),
  amount: z.number().int().positive('Сумма должна быть больше нуля'),
  to_account_id: z.string().uuid().nullable().optional(),
  to_amount: z.number().int().positive().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  place: z.string().max(200).nullable().optional(),
});

type TxDraft = Partial<z.infer<typeof txBase>>;

const transferHasSecondSide = (v: TxDraft) =>
  v.kind !== 'transfer' || Boolean(v.to_account_id && v.to_amount);

const secondSideOnlyForTransfer = (v: TxDraft) =>
  v.kind === undefined || v.kind === 'transfer' || (!v.to_account_id && !v.to_amount);

const notSameAccount = (v: TxDraft) =>
  !v.to_account_id || v.account_id !== v.to_account_id;

const txInput = txBase
  .refine(transferHasSecondSide, {
    message: 'У перевода нужны счёт получателя и полученная сумма',
    path: ['to_account_id'],
  })
  .refine(secondSideOnlyForTransfer, {
    message: 'Вторая сторона бывает только у перевода',
    path: ['to_account_id'],
  })
  .refine(notSameAccount, {
    message: 'Перевод на тот же счёт лишён смысла',
    path: ['to_account_id'],
  });

const txPatch = txBase.partial().refine(notSameAccount, {
  message: 'Перевод на тот же счёт лишён смысла',
  path: ['to_account_id'],
});

interface AccountRow {
  id: string;
  name: string;
  currency: string;
  shared: number;
  owner_id: string | null;
}

function visibleAccountIds(userId: string): Set<string> {
  const rows = db
    .prepare(`SELECT a.id FROM accounts a WHERE ${ACCOUNT_VISIBLE}`)
    .all(userId) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

export async function registerMoneyRoutes(app: FastifyInstance): Promise<void> {
  // ── Счета ───────────────────────────────────────────────────────────────

  /**
   * Остаток считается, а не хранится: начальный плюс движения.
   * Хранимый баланс разъезжается с историей после любой правки задним числом.
   */
  app.get('/api/accounts', (req) => {
    const { archived } = z
      .object({ archived: z.enum(['true', 'false']).optional() })
      .parse(req.query);
    const clause = archived === 'true' ? 'IS NOT NULL' : 'IS NULL';

    const rows = db
      .prepare(
        `SELECT a.*, u.name AS owner_name,
                a.opening_balance
                  - coalesce((SELECT sum(t.amount) FROM transactions t
                       WHERE t.account_id = a.id AND t.kind = 'expense'), 0)
                  + coalesce((SELECT sum(t.amount) FROM transactions t
                       WHERE t.account_id = a.id AND t.kind = 'income'), 0)
                  - coalesce((SELECT sum(t.amount) FROM transactions t
                       WHERE t.account_id = a.id AND t.kind = 'transfer'), 0)
                  + coalesce((SELECT sum(t.to_amount) FROM transactions t
                       WHERE t.to_account_id = a.id AND t.kind = 'transfer'), 0)
                AS balance,
                (SELECT count(*) FROM transactions t
                  WHERE t.account_id = a.id OR t.to_account_id = a.id) AS tx_count,
                (SELECT r.actual_balance FROM reconciliations r
                  WHERE r.account_id = a.id ORDER BY r.checked_on DESC LIMIT 1) AS last_actual,
                (SELECT r.checked_on FROM reconciliations r
                  WHERE r.account_id = a.id ORDER BY r.checked_on DESC LIMIT 1) AS last_checked_on,
                (SELECT r.created_at FROM reconciliations r
                  WHERE r.account_id = a.id ORDER BY r.checked_on DESC LIMIT 1) AS last_checked_at
           FROM accounts a
           LEFT JOIN users u ON u.id = a.owner_id
          WHERE ${ACCOUNT_VISIBLE} AND a.archived_at ${clause}
          ORDER BY a.shared DESC, a.position, a.name`,
      )
      .all(req.user?.id ?? '') as (AccountRow & {
      balance: number;
      last_actual: number | null;
      last_checked_on: string | null;
      last_checked_at: string | null;
      opening_balance: number;
    })[];

    /**
     * Остаток на момент сверки — для расхождения. Сравнивать актуал из банка
     * с текущим остатком нельзя: каждая операция после сверки сдвигала бы
     * расхождение на свою сумму, и счёт приходилось бы сверять заново после
     * каждой траты.
     *
     * «На момент сверки» — это операции более ранних дат плюс операции дня
     * сверки, введённые до неё (у дат нет времени, различаем по created_at).
     * Обе величины считаются, а не хранятся: пропущенная трата, вписанная
     * задним числом, пересчитает остаток на момент сверки и закроет
     * расхождение — ровно тот рабочий процесс, ради которого сверка нужна.
     */
    const checkedBalance = db.prepare(
      `SELECT
         coalesce(sum(CASE
           WHEN t.account_id = @acc AND t.kind IN ('expense', 'transfer') THEN -t.amount
           WHEN t.account_id = @acc AND t.kind = 'income' THEN t.amount
           ELSE 0 END), 0)
         + coalesce(sum(CASE
             WHEN t.to_account_id = @acc AND t.kind = 'transfer' THEN t.to_amount
             ELSE 0 END), 0) AS movements
        FROM transactions t
       WHERE (t.account_id = @acc OR t.to_account_id = @acc)
         AND (t.occurred_on < @day OR (t.occurred_on = @day AND t.created_at <= @at))`,
    );

    return rows.map((a) => ({
      ...a,
      checked_balance:
        a.last_checked_on === null
          ? null
          : a.opening_balance +
            (
              checkedBalance.get({
                acc: a.id,
                day: a.last_checked_on,
                at: a.last_checked_at,
              }) as { movements: number }
            ).movements,
    }));
  });

  app.post('/api/accounts', (req, reply) => {
    const parsed = accountInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const d = parsed.data;
    const personal = d.shared === false;
    const accountId = id();

    db.prepare(
      `INSERT INTO accounts (id, name, currency, kind, opening_balance, owner_id, shared, color,
                             position, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?,
               (SELECT coalesce(max(position), 0) + 1 FROM accounts), ?)`,
    ).run(
      accountId,
      d.name.trim(),
      d.currency,
      d.kind ?? 'card',
      d.opening_balance ?? 0,
      personal ? (req.user?.id ?? null) : null,
      personal ? 0 : 1,
      d.color ?? '#1F6E8C',
      req.user?.id ?? null,
    );
    return reply.code(201).send(db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId));
  });

  app.patch('/api/accounts/:id', (req, reply) => {
    const { id: accountId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = accountInput.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }

    const account = db
      .prepare(`SELECT a.* FROM accounts a WHERE a.id = ? AND ${ACCOUNT_VISIBLE}`)
      .get(accountId, req.user?.id ?? '') as AccountRow | undefined;
    if (!account) return reply.code(404).send({ error: 'Счёт не найден' });
    if (account.owner_id && account.owner_id !== req.user?.id) {
      return reply.code(403).send({ error: 'Этот счёт принадлежит другому человеку' });
    }

    const d = parsed.data;
    // Смена валюты у счёта с операциями превратила бы историю в кашу
    if (d.currency && d.currency !== account.currency) {
      const used = (
        db
          .prepare(
            'SELECT count(*) AS n FROM transactions WHERE account_id = ? OR to_account_id = ?',
          )
          .get(accountId, accountId) as { n: number }
      ).n;
      if (used > 0) {
        return reply
          .code(409)
          .send({ error: 'У счёта есть операции — валюту менять нельзя, создайте новый счёт' });
      }
    }

    const fields: [string, unknown][] = [];
    if (d.name !== undefined) fields.push(['name', d.name.trim()]);
    if (d.currency !== undefined) fields.push(['currency', d.currency]);
    if (d.kind !== undefined) fields.push(['kind', d.kind]);
    if (d.opening_balance !== undefined) fields.push(['opening_balance', d.opening_balance]);
    if (d.color !== undefined) fields.push(['color', d.color]);
    if (d.shared !== undefined) {
      fields.push(['shared', d.shared ? 1 : 0]);
      fields.push(['owner_id', d.shared ? null : (req.user?.id ?? null)]);
    }
    if (fields.length === 0) return reply.code(400).send({ error: 'Нечего менять' });

    db.prepare(
      `UPDATE accounts SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ?
        WHERE id = ?`,
    ).run(...fields.map(([, v]) => v as string | number | null), now(), accountId);

    return db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId);
  });

  app.post('/api/accounts/:id/archive', (req, reply) => {
    const { id: accountId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const account = db
      .prepare(`SELECT a.archived_at FROM accounts a WHERE a.id = ? AND ${ACCOUNT_VISIBLE}`)
      .get(accountId, req.user?.id ?? '') as { archived_at: string | null } | undefined;
    if (!account) return reply.code(404).send({ error: 'Счёт не найден' });

    const archived = account.archived_at ? null : now();
    db.prepare('UPDATE accounts SET archived_at = ?, updated_at = ? WHERE id = ?').run(
      archived,
      now(),
      accountId,
    );
    return { archived: Boolean(archived) };
  });

  app.delete('/api/accounts/:id', (req, reply) => {
    const { id: accountId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const count = (
      db
        .prepare('SELECT count(*) AS n FROM transactions WHERE account_id = ? OR to_account_id = ?')
        .get(accountId, accountId) as { n: number }
    ).n;
    if (count > 0) {
      return reply.code(409).send({
        error:
          `По счёту ${count} ${plural(count, 'операция', 'операции', 'операций')}. ` +
          'Удаление сотрёт и их — лучше убрать счёт в архив',
      });
    }
    const result = db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Счёт не найден' });
    return { ok: true };
  });

  /** Сверка с банком: фактический остаток и расхождение. */
  app.post('/api/accounts/:id/reconcile', (req, reply) => {
    const { id: accountId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z
      .object({
        checked_on: z.string().regex(DATE),
        actual_balance: z.number().int(),
        note: z.string().max(300).nullable().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Укажите дату и фактический остаток' });

    const visible = db
      .prepare(`SELECT a.id FROM accounts a WHERE a.id = ? AND ${ACCOUNT_VISIBLE}`)
      .get(accountId, req.user?.id ?? '');
    if (!visible) return reply.code(404).send({ error: 'Счёт не найден' });

    // Повторная сверка в тот же день обновляет предыдущую, а не плодит
    // двойников: важен фактический остаток на дату, а не история попыток
    db.prepare(
      `INSERT INTO reconciliations (id, account_id, checked_on, actual_balance, note, created_by)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(account_id, checked_on) DO UPDATE SET
         actual_balance = excluded.actual_balance,
         note = excluded.note,
         created_by = excluded.created_by,
         created_at = datetime('now')`,
    ).run(
      id(),
      accountId,
      parsed.data.checked_on,
      parsed.data.actual_balance,
      parsed.data.note ?? null,
      req.user?.id ?? null,
    );
    return { ok: true };
  });

  // ── Категории ───────────────────────────────────────────────────────────

  app.get('/api/categories', (req) => {
    const { kind } = z
      .object({ kind: z.enum(['expense', 'income']).optional() })
      .parse(req.query);
    const clause = kind ? 'AND kind = ?' : '';
    const args = kind ? [kind] : [];
    return db
      .prepare(
        `SELECT * FROM categories WHERE archived_at IS NULL ${clause}
          ORDER BY kind, position, name`,
      )
      .all(...args);
  });

  app.post('/api/categories', (req, reply) => {
    const parsed = categoryInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    if (parsed.data.parent_id) {
      const problem = parentProblem(parsed.data.parent_id, parsed.data.kind);
      if (problem) return reply.code(400).send({ error: problem });
    }
    const categoryId = id();
    db.prepare(
      `INSERT INTO categories (id, name, kind, color, position, parent_id)
       VALUES (?, ?, ?, ?, (SELECT coalesce(max(position), 0) + 1 FROM categories), ?)`,
    ).run(
      categoryId,
      parsed.data.name.trim(),
      parsed.data.kind,
      parsed.data.color ?? '#5A6A74',
      parsed.data.parent_id ?? null,
    );
    return reply.code(201).send(db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId));
  });

  app.patch('/api/categories/:id', (req, reply) => {
    const { id: categoryId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = categoryInput.partial().omit({ kind: true }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Проверьте поля' });

    const fields: [string, unknown][] = [];
    if (parsed.data.name !== undefined) fields.push(['name', parsed.data.name.trim()]);
    if (parsed.data.color !== undefined) fields.push(['color', parsed.data.color]);
    if (parsed.data.parent_id !== undefined) {
      if (parsed.data.parent_id) {
        if (parsed.data.parent_id === categoryId) {
          return reply.code(400).send({ error: 'Категория не может быть родителем самой себя' });
        }
        const current = db
          .prepare('SELECT kind FROM categories WHERE id = ?')
          .get(categoryId) as { kind: string } | undefined;
        if (!current) return reply.code(404).send({ error: 'Категория не найдена' });
        const problem = parentProblem(parsed.data.parent_id, current.kind);
        if (problem) return reply.code(400).send({ error: problem });
        const children = (
          db
            .prepare('SELECT count(*) AS n FROM categories WHERE parent_id = ?')
            .get(categoryId) as { n: number }
        ).n;
        if (children > 0) {
          return reply
            .code(400)
            .send({ error: 'У категории есть подкатегории — сначала отвяжите их' });
        }
      }
      fields.push(['parent_id', parsed.data.parent_id]);
    }
    if (fields.length === 0) return reply.code(400).send({ error: 'Нечего менять' });

    const result = db
      .prepare(`UPDATE categories SET ${fields.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
      .run(...fields.map(([, v]) => v as string | null), categoryId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Категория не найдена' });
    return db.prepare('SELECT * FROM categories WHERE id = ?').get(categoryId);
  });

  app.delete('/api/categories/:id', (req, reply) => {
    const { id: categoryId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const used = (
      db.prepare('SELECT count(*) AS n FROM transactions WHERE category_id = ?').get(categoryId) as {
        n: number;
      }
    ).n;
    if (used > 0) {
      // Категорию с историей не удаляем, а прячем: иначе прошлые операции
      // потеряют разметку и отчёты за прошлые месяцы изменятся
      db.prepare('UPDATE categories SET archived_at = ? WHERE id = ?').run(now(), categoryId);
      return { archived: true, used };
    }
    db.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
    return { archived: false, used: 0 };
  });

  // ── Операции ────────────────────────────────────────────────────────────

  app.get('/api/transactions', (req) => {
    const q = z
      .object({
        from: z.string().regex(DATE).optional(),
        to: z.string().regex(DATE).optional(),
        account_id: z.string().uuid().optional(),
        category_id: z.string().uuid().optional(),
        kind: z.enum(['expense', 'income', 'transfer']).optional(),
        search: z.string().max(200).optional(),
        limit: z.coerce.number().int().min(1).max(500).optional(),
      })
      .parse(req.query);

    const userId = req.user?.id ?? '';
    const where: string[] = [
      // Операция видна, если видна хотя бы одна её сторона
      `(a.shared = 1 OR a.owner_id = ? OR b.shared = 1 OR b.owner_id = ?)`,
    ];
    const args: unknown[] = [userId, userId];

    if (q.from) {
      where.push('t.occurred_on >= ?');
      args.push(q.from);
    }
    if (q.to) {
      where.push('t.occurred_on <= ?');
      args.push(q.to);
    }
    if (q.account_id) {
      where.push('(t.account_id = ? OR t.to_account_id = ?)');
      args.push(q.account_id, q.account_id);
    }
    if (q.category_id) {
      where.push('t.category_id = ?');
      args.push(q.category_id);
    }
    if (q.kind) {
      where.push('t.kind = ?');
      args.push(q.kind);
    }
    if (q.search) {
      where.push("(ci_contains(coalesce(t.note, ''), ?) OR ci_contains(coalesce(t.place, ''), ?))");
      args.push(q.search, q.search);
    }

    const rows = db
      .prepare(
        `SELECT t.*,
                a.name AS account_name, a.currency AS currency, a.color AS account_color,
                a.shared AS account_shared, a.owner_id AS account_owner,
                b.name AS to_account_name, b.currency AS to_currency,
                b.shared AS to_shared, b.owner_id AS to_owner,
                c.name AS category_name, c.color AS category_color,
                u.name AS author_name,
                (SELECT count(*) FROM attachments att WHERE att.transaction_id = t.id) AS receipts
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           LEFT JOIN accounts b ON b.id = t.to_account_id
           LEFT JOIN categories c ON c.id = t.category_id
           LEFT JOIN users u ON u.id = t.created_by
          WHERE ${where.join(' AND ')}
          ORDER BY t.occurred_on DESC, t.created_at DESC
          LIMIT ?`,
      )
      .all(...args, q.limit ?? 100) as Record<string, unknown>[];

    const visible = visibleAccountIds(userId);

    // Перевод на чужой личный счёт виден суммой, но без названия счёта:
    // скрыть уход денег с общего счёта нельзя, иначе остаток будет неверным
    return rows.map((row) => {
      const masked = { ...row };
      if (row['to_account_id'] && !visible.has(row['to_account_id'] as string)) {
        masked['to_account_name'] = 'Личный счёт';
      }
      if (!visible.has(row['account_id'] as string)) {
        masked['account_name'] = 'Личный счёт';
        masked['note'] = null;
        masked['place'] = null;
        masked['category_name'] = null;
      }
      return masked;
    });
  });

  app.post('/api/transactions', (req, reply) => {
    const parsed = txInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const d = parsed.data;
    const visible = visibleAccountIds(req.user?.id ?? '');

    if (!visible.has(d.account_id)) return reply.code(400).send({ error: 'Счёт не найден' });
    if (d.to_account_id && !visible.has(d.to_account_id)) {
      return reply.code(400).send({ error: 'Счёт получателя не найден' });
    }

    if (d.category_id) {
      const category = db
        .prepare('SELECT kind FROM categories WHERE id = ?')
        .get(d.category_id) as { kind: string } | undefined;
      if (!category) return reply.code(400).send({ error: 'Категория не найдена' });
      if (d.kind === 'transfer') {
        return reply.code(400).send({ error: 'У перевода категории нет' });
      }
      if (category.kind !== d.kind) {
        return reply
          .code(400)
          .send({ error: 'Категория не того вида: у трат и доходов они разные' });
      }
    }

    const txId = id();
    db.prepare(
      `INSERT INTO transactions (id, kind, occurred_on, account_id, amount, to_account_id,
                                 to_amount, category_id, note, place, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      txId,
      d.kind,
      d.occurred_on,
      d.account_id,
      d.amount,
      d.to_account_id ?? null,
      d.to_amount ?? null,
      d.category_id ?? null,
      d.note ?? null,
      d.place ?? null,
      req.user?.id ?? null,
    );
    return reply.code(201).send(db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId));
  });

  app.patch('/api/transactions/:id', (req, reply) => {
    const { id: txId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = txPatch.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }

    const visible = visibleAccountIds(req.user?.id ?? '');
    const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId) as
      | { account_id: string; kind: string }
      | undefined;
    if (!tx || !visible.has(tx.account_id)) {
      return reply.code(404).send({ error: 'Операция не найдена' });
    }

    const d = parsed.data;
    const fields: [string, unknown][] = [];
    for (const key of ['occurred_on', 'amount', 'note', 'place', 'to_amount'] as const) {
      if (d[key] !== undefined) fields.push([key, d[key]]);
    }
    // Категория проверяется так же, как при создании: иначе правкой можно
    // повесить доходную категорию на трату, и отчёты по категориям поедут
    if (d.category_id !== undefined) {
      if (d.category_id) {
        if (tx.kind === 'transfer') {
          return reply.code(400).send({ error: 'У перевода категории нет' });
        }
        const category = db
          .prepare('SELECT kind FROM categories WHERE id = ?')
          .get(d.category_id) as { kind: string } | undefined;
        if (!category) return reply.code(400).send({ error: 'Категория не найдена' });
        if (category.kind !== tx.kind) {
          return reply
            .code(400)
            .send({ error: 'Категория не того вида: у трат и доходов они разные' });
        }
      }
      fields.push(['category_id', d.category_id]);
    }
    if (d.account_id !== undefined) {
      if (!visible.has(d.account_id)) return reply.code(400).send({ error: 'Счёт не найден' });
      fields.push(['account_id', d.account_id]);
    }
    if (d.to_account_id !== undefined) {
      if (d.to_account_id && !visible.has(d.to_account_id)) {
        return reply.code(400).send({ error: 'Счёт получателя не найден' });
      }
      fields.push(['to_account_id', d.to_account_id]);
    }
    if (fields.length === 0) return reply.code(400).send({ error: 'Нечего менять' });

    db.prepare(
      `UPDATE transactions SET ${fields.map(([k]) => `${k} = ?`).join(', ')}, updated_at = ?
        WHERE id = ?`,
    ).run(...fields.map(([, v]) => v as string | number | null), now(), txId);

    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  });

  app.delete('/api/transactions/:id', async (req, reply) => {
    const { id: txId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const visible = visibleAccountIds(req.user?.id ?? '');
    const tx = db.prepare('SELECT account_id FROM transactions WHERE id = ?').get(txId) as
      | { account_id: string }
      | undefined;
    if (!tx || !visible.has(tx.account_id)) {
      return reply.code(404).send({ error: 'Операция не найдена' });
    }

    // Строки уйдут каскадом, файлы чеков надо убрать руками
    const receipts = db
      .prepare('SELECT storage_path FROM attachments WHERE transaction_id = ?')
      .all(txId) as { storage_path: string }[];

    db.prepare('DELETE FROM transactions WHERE id = ?').run(txId);

    for (const file of receipts) {
      await unlink(resolve(paths.attachments, file.storage_path)).catch(() => {});
    }
    return { ok: true };
  });

  /** Операция с чеками — для карточки. */
  app.get('/api/transactions/:id/attachments', (req, reply) => {
    const { id: txId } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!visibleAccountIds(req.user?.id ?? '').has(
      (db.prepare('SELECT account_id FROM transactions WHERE id = ?').get(txId) as
        | { account_id: string }
        | undefined)?.account_id ?? '',
    )) {
      return reply.code(404).send({ error: 'Операция не найдена' });
    }
    return db
      .prepare(
        `SELECT id, filename, mime, size_bytes,
                CASE WHEN mime LIKE 'image/%' THEN 1 ELSE 0 END AS is_image
           FROM attachments WHERE transaction_id = ? ORDER BY created_at`,
      )
      .all(txId);
  });

  // ── Сводка за месяц ─────────────────────────────────────────────────────

  /** Итоги по каждой валюте отдельно: общего итога без курса не бывает. */
  app.get('/api/money/summary', (req, reply) => {
    const parsed = z
      .object({ from: z.string().regex(DATE), to: z.string().regex(DATE) })
      .safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Нужны границы периода' });

    const userId = req.user?.id ?? '';
    const { from, to } = parsed.data;

    const byCurrency = db
      .prepare(
        `SELECT a.currency, t.kind, sum(t.amount) AS total
           FROM transactions t JOIN accounts a ON a.id = t.account_id
          WHERE ${ACCOUNT_VISIBLE} AND t.occurred_on BETWEEN ? AND ?
            AND t.kind IN ('expense','income')
          GROUP BY a.currency, t.kind`,
      )
      .all(userId, from, to) as { currency: string; kind: string; total: number }[];

    const byCategory = db
      .prepare(
        `SELECT a.currency, c.id AS category_id, c.name AS category_name, c.color,
                c.kind, c.parent_id, sum(t.amount) AS total, count(*) AS count
           FROM transactions t
           JOIN accounts a ON a.id = t.account_id
           LEFT JOIN categories c ON c.id = t.category_id
          WHERE ${ACCOUNT_VISIBLE} AND t.occurred_on BETWEEN ? AND ?
            AND t.kind IN ('expense','income')
          GROUP BY a.currency, c.id
          ORDER BY total DESC`,
      )
      .all(userId, from, to);

    return { from, to, byCurrency, byCategory };
  });
}
