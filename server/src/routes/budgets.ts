import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { db, id, now, today } from '../db/index.js';
import { expandOccurrences, isValidRecurrence } from '../lib/recurrence.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH = /^\d{4}-\d{2}$/;

const ACCOUNT_VISIBLE = '(a.shared = 1 OR a.owner_id = ?)';

function visibleAccountIds(userId: string): Set<string> {
  const rows = db
    .prepare(`SELECT a.id FROM accounts a WHERE ${ACCOUNT_VISIBLE}`)
    .all(userId) as { id: string }[];
  return new Set(rows.map((r) => r.id));
}

// ── Регулярные операции ───────────────────────────────────────────────────

interface RecurringRow {
  id: string;
  title: string;
  kind: string;
  start_on: string;
  recurrence_rule: string;
  account_id: string;
  amount: number;
  to_account_id: string | null;
  to_amount: number | null;
  category_id: string | null;
  note: string | null;
  place: string | null;
  auto_create: number;
  active: number;
  created_by: string | null;
}

export interface DueItem {
  recurring_id: string;
  occurred_on: string;
  title: string;
  kind: string;
  amount: number;
  currency: string;
  account_name: string;
  category_name: string | null;
  auto_create: number;
}

/**
 * Экземпляры правил, которым пора наступить, но которых ещё нет.
 *
 * Считается вычитанием: все даты правила до сегодня минус уже созданные
 * операции минус пропущенные вручную. Курсор «следующая дата» не храним —
 * он разъезжается после любой правки правила задним числом, а вычитание
 * всегда даёт один и тот же ответ.
 */
export function dueOccurrences(userId: string, horizon = today()): DueItem[] {
  const rules = db
    .prepare(
      `SELECT r.*, a.currency, a.name AS account_name, c.name AS category_name
         FROM recurring_transactions r
         JOIN accounts a ON a.id = r.account_id
         LEFT JOIN categories c ON c.id = r.category_id
        WHERE r.active = 1 AND ${ACCOUNT_VISIBLE}`,
    )
    .all(userId) as (RecurringRow & {
    currency: string;
    account_name: string;
    category_name: string | null;
  })[];

  const doneStmt = db.prepare(
    'SELECT recurring_on FROM transactions WHERE recurring_id = ? AND recurring_on IS NOT NULL',
  );
  const skipStmt = db.prepare('SELECT occurred_on FROM recurring_skips WHERE recurring_id = ?');

  const due: DueItem[] = [];

  for (const rule of rules) {
    const handled = new Set([
      ...(doneStmt.all(rule.id) as { recurring_on: string }[]).map((r) => r.recurring_on),
      ...(skipStmt.all(rule.id) as { occurred_on: string }[]).map((r) => r.occurred_on),
    ]);

    for (const date of expandOccurrences(rule.start_on, rule.recurrence_rule, rule.start_on, horizon)) {
      if (handled.has(date)) continue;
      due.push({
        recurring_id: rule.id,
        occurred_on: date,
        title: rule.title,
        kind: rule.kind,
        amount: rule.amount,
        currency: rule.currency,
        account_name: rule.account_name,
        category_name: rule.category_name,
        auto_create: rule.auto_create,
      });
    }
  }

  return due.sort((a, b) => a.occurred_on.localeCompare(b.occurred_on));
}

/** Создаёт операцию из правила на указанную дату. Повторный вызов безвреден. */
function materialize(ruleId: string, date: string, userId: string | null): string | null {
  const rule = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(ruleId) as
    | RecurringRow
    | undefined;
  if (!rule) return null;

  const exists = db
    .prepare('SELECT id FROM transactions WHERE recurring_id = ? AND recurring_on = ?')
    .get(ruleId, date) as { id: string } | undefined;
  if (exists) return exists.id;

  const txId = id();
  db.prepare(
    `INSERT INTO transactions (id, kind, occurred_on, account_id, amount, to_account_id, to_amount,
                               category_id, note, place, recurring_id, recurring_on, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    txId,
    rule.kind,
    date,
    rule.account_id,
    rule.amount,
    rule.to_account_id,
    rule.to_amount,
    rule.category_id,
    rule.note,
    rule.place,
    ruleId,
    date,
    userId,
  );
  return txId;
}

/**
 * Создаёт всё, что помечено «создавать самостоятельно».
 * Вызывается при старте сервера и при запросе списка ожидающих.
 */
export function runAutoCreate(): number {
  const rules = db
    .prepare('SELECT id FROM recurring_transactions WHERE active = 1 AND auto_create = 1')
    .all() as { id: string }[];
  if (rules.length === 0) return 0;

  let created = 0;
  const run = db.transaction(() => {
    for (const { id: ruleId } of rules) {
      const rule = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(ruleId) as
        | RecurringRow
        | undefined;
      if (!rule) continue;

      const handled = new Set([
        ...(
          db
            .prepare('SELECT recurring_on FROM transactions WHERE recurring_id = ?')
            .all(ruleId) as { recurring_on: string | null }[]
        )
          .map((r) => r.recurring_on)
          .filter((v): v is string => v !== null),
        ...(
          db.prepare('SELECT occurred_on FROM recurring_skips WHERE recurring_id = ?').all(ruleId) as {
            occurred_on: string;
          }[]
        ).map((r) => r.occurred_on),
      ]);

      for (const date of expandOccurrences(
        rule.start_on,
        rule.recurrence_rule,
        rule.start_on,
        today(),
      )) {
        if (handled.has(date)) continue;
        if (materialize(ruleId, date, rule.created_by ?? null)) created += 1;
      }
    }
  });
  run();
  return created;
}

// ── Схемы ─────────────────────────────────────────────────────────────────

const recurringInput = z.object({
  title: z.string().min(1, 'Укажите название').max(200),
  kind: z.enum(['expense', 'income', 'transfer']),
  start_on: z.string().regex(DATE, 'Дата в формате ГГГГ-ММ-ДД'),
  recurrence_rule: z.string().min(1).max(100),
  account_id: z.string().uuid(),
  amount: z.number().int().positive('Сумма должна быть больше нуля'),
  to_account_id: z.string().uuid().nullable().optional(),
  to_amount: z.number().int().positive().nullable().optional(),
  category_id: z.string().uuid().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
  place: z.string().max(200).nullable().optional(),
  auto_create: z.boolean().optional(),
  active: z.boolean().optional(),
});

export async function registerBudgetRoutes(app: FastifyInstance): Promise<void> {
  // ── Лимиты ──────────────────────────────────────────────────────────────

  /**
   * Лимиты на месяц: постоянный, если на этот месяц нет исключения.
   * Вместе с потраченным и остатком — считать это на клиенте значило бы
   * повторять там правило выбора лимита.
   */
  app.get('/api/budgets', (req, reply) => {
    const parsed = z.object({ month: z.string().regex(MONTH) }).safeParse(req.query);
    if (!parsed.success) return reply.code(400).send({ error: 'Нужен месяц в формате ГГГГ-ММ' });

    const { month } = parsed.data;
    const userId = req.user?.id ?? '';
    const from = `${month}-01`;
    const to = `${month}-31`;

    /*
      Выбираем по одному лимиту на пару «категория + валюта»: исключение
      на запрошенный месяц, иначе постоянный. Исключения других месяцев
      в выборку не попадают вовсе — иначе лимит на декабрь отменял бы
      постоянный лимит во все остальные месяцы.
    */
    return db
      .prepare(
        `WITH chosen AS (
           SELECT b.*,
                  row_number() OVER (
                    PARTITION BY b.category_id, b.currency
                    ORDER BY CASE WHEN b.month IS NULL THEN 1 ELSE 0 END
                  ) AS rn
             FROM budgets b
            WHERE b.month IS NULL OR b.month = ?
         )
         SELECT c.id AS category_id, c.name AS category_name, c.color, b.currency,
                b.amount AS limit_amount, b.month AS limit_month, b.id AS budget_id,
                coalesce((
                  SELECT sum(t.amount) FROM transactions t
                    JOIN accounts a ON a.id = t.account_id
                   -- Лимит на родителя считает и траты подкатегорий:
                   -- «Автотраты» — это топливо, парковка и сервис вместе
                   WHERE t.category_id IN (
                           SELECT id FROM categories WHERE id = c.id OR parent_id = c.id
                         )
                     AND t.kind = 'expense'
                     AND a.currency = b.currency
                     AND t.occurred_on BETWEEN ? AND ?
                     AND ${ACCOUNT_VISIBLE}
                ), 0) AS spent
           FROM chosen b
           JOIN categories c ON c.id = b.category_id
          WHERE b.rn = 1 AND c.archived_at IS NULL
          ORDER BY c.position, c.name`,
      )
      .all(month, from, to, userId);
  });

  app.put('/api/budgets', (req, reply) => {
    const parsed = z
      .object({
        category_id: z.string().uuid(),
        currency: z.string().regex(/^[A-Z]{3}$/),
        month: z.string().regex(MONTH).nullable().optional(),
        amount: z.number().int().positive('Лимит должен быть больше нуля'),
      })
      .safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const d = parsed.data;

    const category = db
      .prepare("SELECT kind FROM categories WHERE id = ?")
      .get(d.category_id) as { kind: string } | undefined;
    if (!category) return reply.code(400).send({ error: 'Категория не найдена' });
    if (category.kind !== 'expense') {
      return reply.code(400).send({ error: 'Лимит имеет смысл только для категории трат' });
    }

    db.prepare(
      `INSERT INTO budgets (id, category_id, currency, month, amount)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(category_id, currency, coalesce(month, ''))
       DO UPDATE SET amount = excluded.amount, updated_at = datetime('now')`,
    ).run(id(), d.category_id, d.currency, d.month ?? null, d.amount);

    return { ok: true };
  });

  app.delete('/api/budgets/:id', (req, reply) => {
    const { id: budgetId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const result = db.prepare('DELETE FROM budgets WHERE id = ?').run(budgetId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Лимит не найден' });
    return { ok: true };
  });

  // ── Регулярные операции ─────────────────────────────────────────────────

  app.get('/api/recurring', (req) =>
    db
      .prepare(
        `SELECT r.*, a.name AS account_name, a.currency, c.name AS category_name,
                (SELECT count(*) FROM transactions t WHERE t.recurring_id = r.id) AS created_count
           FROM recurring_transactions r
           JOIN accounts a ON a.id = r.account_id
           LEFT JOIN categories c ON c.id = r.category_id
          WHERE ${ACCOUNT_VISIBLE}
          ORDER BY r.active DESC, r.title`,
      )
      .all(req.user?.id ?? ''),
  );

  app.post('/api/recurring', (req, reply) => {
    const parsed = recurringInput.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const d = parsed.data;

    if (!isValidRecurrence(d.recurrence_rule)) {
      return reply.code(400).send({ error: 'Правило повтора не разобрать' });
    }
    const visible = visibleAccountIds(req.user?.id ?? '');
    if (!visible.has(d.account_id)) return reply.code(400).send({ error: 'Счёт не найден' });
    if (d.kind === 'transfer' && !(d.to_account_id && d.to_amount)) {
      return reply.code(400).send({ error: 'У перевода нужны счёт получателя и сумма зачисления' });
    }
    if (d.to_account_id && !visible.has(d.to_account_id)) {
      return reply.code(400).send({ error: 'Счёт получателя не найден' });
    }

    const ruleId = id();
    db.prepare(
      `INSERT INTO recurring_transactions
         (id, title, kind, start_on, recurrence_rule, account_id, amount, to_account_id, to_amount,
          category_id, note, place, auto_create, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      ruleId,
      d.title.trim(),
      d.kind,
      d.start_on,
      d.recurrence_rule,
      d.account_id,
      d.amount,
      d.to_account_id ?? null,
      d.to_amount ?? null,
      d.kind === 'transfer' ? null : (d.category_id ?? null),
      d.note ?? null,
      d.place ?? null,
      d.auto_create ? 1 : 0,
      req.user?.id ?? null,
    );

    if (d.auto_create) runAutoCreate();
    return reply
      .code(201)
      .send(db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(ruleId));
  });

  app.patch('/api/recurring/:id', (req, reply) => {
    const { id: ruleId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = recurringInput.partial().safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: parsed.error.issues[0]?.message ?? 'Проверьте поля' });
    }
    const rule = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(ruleId) as
      | RecurringRow
      | undefined;
    if (!rule) return reply.code(404).send({ error: 'Правило не найдено' });

    const visible = visibleAccountIds(req.user?.id ?? '');
    if (!visible.has(rule.account_id)) return reply.code(404).send({ error: 'Правило не найдено' });

    const d = parsed.data;
    if (d.recurrence_rule && !isValidRecurrence(d.recurrence_rule)) {
      return reply.code(400).send({ error: 'Правило повтора не разобрать' });
    }

    const fields: [string, unknown][] = [];
    for (const key of [
      'title',
      'kind',
      'start_on',
      'recurrence_rule',
      'account_id',
      'amount',
      'to_account_id',
      'to_amount',
      'category_id',
      'note',
      'place',
    ] as const) {
      if (d[key] !== undefined) fields.push([key, d[key]]);
    }
    if (d.auto_create !== undefined) fields.push(['auto_create', d.auto_create ? 1 : 0]);
    if (d.active !== undefined) fields.push(['active', d.active ? 1 : 0]);
    if (fields.length === 0) return reply.code(400).send({ error: 'Нечего менять' });

    db.prepare(
      `UPDATE recurring_transactions SET ${fields.map(([k]) => `${k} = ?`).join(', ')},
        updated_at = ? WHERE id = ?`,
    ).run(...fields.map(([, v]) => v as string | number | null), now(), ruleId);

    return db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(ruleId);
  });

  app.delete('/api/recurring/:id', (req, reply) => {
    const { id: ruleId } = z.object({ id: z.string().uuid() }).parse(req.params);
    // Созданные операции остаются в истории: они уже случились
    const result = db.prepare('DELETE FROM recurring_transactions WHERE id = ?').run(ruleId);
    if (result.changes === 0) return reply.code(404).send({ error: 'Правило не найдено' });
    return { ok: true };
  });

  /** Что пора подтвердить или что уже создалось само. */
  app.get('/api/recurring/due', (req) => {
    runAutoCreate();
    return dueOccurrences(req.user?.id ?? '');
  });

  app.post('/api/recurring/:id/confirm', (req, reply) => {
    const { id: ruleId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z
      .object({
        occurred_on: z.string().regex(DATE),
        // Фактическая сумма может отличаться от плановой: зарплата с премией,
        // аренда с изменившимся счётом за воду
        amount: z.number().int().positive().optional(),
      })
      .safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Нужна дата экземпляра' });

    const rule = db.prepare('SELECT * FROM recurring_transactions WHERE id = ?').get(ruleId) as
      | RecurringRow
      | undefined;
    if (!rule) return reply.code(404).send({ error: 'Правило не найдено' });
    if (!visibleAccountIds(req.user?.id ?? '').has(rule.account_id)) {
      return reply.code(404).send({ error: 'Правило не найдено' });
    }

    const txId = materialize(ruleId, parsed.data.occurred_on, req.user?.id ?? null);
    if (!txId) return reply.code(400).send({ error: 'Не удалось создать операцию' });

    if (parsed.data.amount) {
      db.prepare('UPDATE transactions SET amount = ?, updated_at = ? WHERE id = ?').run(
        parsed.data.amount,
        now(),
        txId,
      );
    }
    return db.prepare('SELECT * FROM transactions WHERE id = ?').get(txId);
  });

  app.post('/api/recurring/:id/skip', (req, reply) => {
    const { id: ruleId } = z.object({ id: z.string().uuid() }).parse(req.params);
    const parsed = z.object({ occurred_on: z.string().regex(DATE) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: 'Нужна дата экземпляра' });

    const rule = db
      .prepare('SELECT account_id FROM recurring_transactions WHERE id = ?')
      .get(ruleId) as { account_id: string } | undefined;
    if (!rule || !visibleAccountIds(req.user?.id ?? '').has(rule.account_id)) {
      return reply.code(404).send({ error: 'Правило не найдено' });
    }

    db.prepare(
      'INSERT OR IGNORE INTO recurring_skips (recurring_id, occurred_on) VALUES (?, ?)',
    ).run(ruleId, parsed.data.occurred_on);
    return { ok: true };
  });
}
