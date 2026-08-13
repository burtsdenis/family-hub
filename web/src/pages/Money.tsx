import { t } from '../lib/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useDialogs } from '../components/Dialog';
import { EntityDialog, PALETTE } from '../components/EntityDialog';
import { TransactionDialog } from '../components/TransactionDialog';
import { Empty, Page } from '../components/Page';
import { BudgetsPanel } from '../components/BudgetsPanel';
import { DonutChart } from '../components/DonutChart';
import { DuePanel, RecurringPanel, type DueItem } from '../components/RecurringPanel';
import { onEnter } from '../lib/keys';
import { useLatest } from '../lib/latest';
import { addMonths, formatDate, monthTitle, plural } from '../lib/format';
import { today as todayISO } from '../lib/tasks';
import {
  ACCOUNT_KIND_LABEL,
  COMMON_CURRENCIES,
  formatMoney,
  groupByCurrency,
  monthBounds,
  orderCategories,
  parseAmount,
  type Account,
  type Category,
  type Summary,
  type Transaction,
} from '../lib/money';

const chip = 'rounded-full border px-3 py-1.5 text-sm transition-colors';
const chipOn = 'border-accent bg-accent-soft text-accent';
const chipOff = 'border-line text-muted hover:text-ink';
const field =
  'rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-accent';

export function Money() {
  const today = todayISO();
  const dialogs = useDialogs();
  const isLatest = useLatest();

  const [accounts, setAccounts] = useState<Account[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [anchor, setAnchor] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [due, setDue] = useState<DueItem[]>([]);
  const [tab, setTab] = useState<'operations' | 'budgets' | 'recurring'>('operations');

  // Quick entry: amount and category, everything else defaulted
  const [quickAmount, setQuickAmount] = useState('');
  const [quickCategory, setQuickCategory] = useState('');
  const [quickAccount, setQuickAccount] = useState('');

  const [editingTx, setEditingTx] = useState<Transaction | null>(null);
  const [creatingTx, setCreatingTx] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [creatingAccount, setCreatingAccount] = useState(false);
  const [newCurrency, setNewCurrency] = useState('EUR');
  const [editingCategory, setEditingCategory] = useState<Category | null>(null);
  const [creatingCategoryKind, setCreatingCategoryKind] = useState<'expense' | 'income' | null>(
    null,
  );
  // Parent in the category dialog. Separate state because EntityDialog is
  // generic and knows nothing about the category hierarchy.
  const [categoryParent, setCategoryParent] = useState('');
  // Expanded parents in the "By category" summary
  const [expandedCats, setExpandedCats] = useState<Set<string>>(new Set());

  const { from, to } = useMemo(() => monthBounds(anchor), [anchor]);

  const load = useCallback(async () => {
    const fresh = isLatest();
    try {
      const [acc, cats, txs, sum, dueItems, settings] = await Promise.all([
        api.get<Account[]>('/accounts'),
        api.get<Category[]>('/categories'),
        api.get<Transaction[]>(`/transactions?from=${from}&to=${to}&limit=200`),
        api.get<Summary>(`/money/summary?from=${from}&to=${to}`),
        // This request also catches up whatever is marked "create automatically"
        api.get<DueItem[]>('/recurring/due'),
        api.get<Record<string, string>>('/settings'),
      ]);
      if (!fresh()) return;
      setAccounts(acc);
      setCategories(cats);
      setTransactions(txs);
      setSummary(sum);
      setDue(dueItems);
      setError(null);
      setQuickAccount((prev) => prev || acc.find((a) => a.shared === 1)?.id || acc[0]?.id || '');
      // New account currency: the hub setting, else the first account's currency
      const preferred = settings['money.default_currency']?.trim().toUpperCase();
      setNewCurrency((prev) =>
        prev !== 'EUR' ? prev : preferred || acc[0]?.currency || 'EUR',
      );
    } catch (err) {
      if (!fresh()) return;
      setError(err instanceof Error ? err.message : t('Не удалось загрузить'));
    }
  }, [from, to, isLatest]);

  useEffect(() => {
    void load();
  }, [load]);

  // Arriving from the quick-actions screen: /money?add=1 opens the form right away
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (!params.get('add')) return;
    setCreatingTx(true);
    setParams({}, { replace: true });
  }, [params, setParams]);

  const expenseCategories = orderCategories(categories, 'expense');
  const groups = useMemo(() => groupByCurrency(accounts ?? []), [accounts]);

  async function quickAdd() {
    const amount = parseAmount(quickAmount);
    if (amount === null || amount === 0 || !quickAccount) return;
    try {
      await api.post('/transactions', {
        kind: 'expense',
        occurred_on: today,
        account_id: quickAccount,
        amount,
        category_id: quickCategory || null,
      });
      setQuickAmount('');
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Не удалось добавить'));
    }
  }

  async function reconcile(account: Account) {
    const entered = await dialogs.prompt({
      title: t('Сверка: {name}', { name: account.name }),
      label: t('Фактический остаток по банку, {currency}', { currency: account.currency }),
      value: (account.balance / 100).toString(),
      confirmLabel: t('Сверить'),
    });
    if (!entered) return;
    const actual = parseAmount(entered);
    if (actual === null) {
      setError(t('Не разобрал сумму'));
      return;
    }
    await api.post(`/accounts/${account.id}/reconcile`, {
      checked_on: today,
      actual_balance: actual,
    });
    await load();
  }

  const byDate = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    for (const tx of transactions) {
      const list = map.get(tx.occurred_on) ?? [];
      list.push(tx);
      map.set(tx.occurred_on, list);
    }
    return [...map.entries()];
  }, [transactions]);

  const expenseTotals = (summary?.byCurrency ?? []).filter((r) => r.kind === 'expense');
  const incomeTotals = (summary?.byCurrency ?? []).filter((r) => r.kind === 'income');

  // Expenses by category, grouped by currency: each currency gets its own
  // donut — shares across currencies mean nothing without a rate.
  // Subcategories roll up into their parent; its row expands on click.
  const expenseByCurrency = useMemo(() => {
    const rows = (summary?.byCategory ?? []).filter((r) => r.kind === 'expense');
    type Row = (typeof rows)[number];
    interface Rolled {
      key: string;
      name: string | null;
      color: string | null;
      total: number;
      count: number;
      currency: string;
      children: Row[];
    }

    const byId = new Map(categories.map((c) => [c.id, c]));
    const byCurrency = new Map<string, Map<string, Rolled>>();

    for (const r of rows) {
      const bucket = byCurrency.get(r.currency) ?? new Map<string, Rolled>();
      byCurrency.set(r.currency, bucket);

      // A row rolls up into its parent only if the parent is visible (not
      // archived) — otherwise the subcategory shows on its own, as a
      // top-level category
      const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
      const key = parent?.id ?? r.category_id ?? 'none';
      const entry = bucket.get(key) ?? {
        key,
        name: parent?.name ?? r.category_name,
        color: parent?.color ?? r.color,
        total: 0,
        count: 0,
        currency: r.currency,
        children: [],
      };
      entry.total += r.total;
      entry.count += r.count;
      // The parent's own spending in the expanded list is the remainder,
      // not a row — no separate child entry needed for it
      if (parent) entry.children.push(r);
      bucket.set(key, entry);
    }

    return [...byCurrency.entries()].map(([currency, bucket]) => {
      const rolled = [...bucket.values()].sort((a, b) => b.total - a.total);
      return {
        currency,
        rows: rolled,
        total: rolled.reduce((sum, r) => sum + r.total, 0),
      };
    });
  }, [summary, categories]);

  function toggleExpanded(key: string) {
    setExpandedCats((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  return (
    <Page
      title={t('Деньги')}
      eyebrow={t('Счета и траты')}
      action={
        <button
          type="button"
          onClick={() => setCreatingTx(true)}
          className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          {t('Операция')}
        </button>
      }
    >
      {error && (
        <p className="mb-4 rounded-lg border border-urgent bg-urgent/10 px-4 py-2.5 text-sm text-ink">
          {error}
        </p>
      )}

      {accounts === null ? (
        <div className="h-64 animate-pulse rounded-card bg-surface-3" />
      ) : accounts.length === 0 ? (
        <div className="space-y-4">
          <Empty>
            {t('Счетов пока нет. Начните с того, где лежат деньги: карта, наличные, копилка.')}
          </Empty>
          <button
            type="button"
            onClick={() => setCreatingAccount(true)}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {t('Добавить счёт')}
          </button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Balances by currency */}
          <div className="space-y-4">
            {groups.map((group) => (
              <section key={group.currency}>
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="eyebrow">{group.currency}</h2>
                  <span className="font-display text-lg font-semibold text-ink">
                    {formatMoney(group.total, group.currency)}
                  </span>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {group.items.map((a) => {
                    // The discrepancy is as of the reconciliation, not
                    // against the current balance: transactions after the
                    // check do not move it
                    const diff =
                      a.last_actual === null || a.checked_balance === null
                        ? null
                        : a.last_actual - a.checked_balance;
                    return (
                      <article
                        key={a.id}
                        className="rounded-card border border-line bg-surface p-4"
                        style={{ borderLeft: `3px solid ${a.color}` }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-ink">{a.name}</p>
                            <p className="text-xs text-muted">
                              {ACCOUNT_KIND_LABEL[a.kind]}
                              {a.shared ? '' : ` · ${t('личный')}`}
                            </p>
                          </div>
                          <button
                            type="button"
                            onClick={() => setEditingAccount(a)}
                            aria-label={t('Настроить счёт {name}', { name: a.name })}
                            className="text-muted opacity-60 hover:opacity-100"
                          >
                            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="3" />
                              <path d="M12 4v2M12 18v2M20 12h-2M6 12H4M17.7 6.3l-1.4 1.4M7.7 16.3l-1.4 1.4M17.7 17.7l-1.4-1.4M7.7 7.7 6.3 6.3" />
                            </svg>
                          </button>
                        </div>

                        <p className="mt-2 font-display text-xl font-semibold text-ink">
                          {formatMoney(a.balance, a.currency)}
                        </p>

                        <div className="mt-2 flex items-center justify-between gap-2">
                          {diff === null ? (
                            <span className="text-xs text-muted">{t('Не сверялся')}</span>
                          ) : diff === 0 ? (
                            <span className="text-xs text-done">
                              {t('Сходится с банком')}, {formatDate(a.last_checked_on!)}
                            </span>
                          ) : (
                            <span className="text-xs text-urgent">
                              {t('Расхождение')} {formatMoney(diff, a.currency)},{' '}
                              {formatDate(a.last_checked_on!)}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={() => void reconcile(a)}
                            className="shrink-0 text-xs text-accent underline underline-offset-2"
                          >
                            {t('Сверить')}
                          </button>
                        </div>
                      </article>
                    );
                  })}

                  <button
                    type="button"
                    onClick={() => setCreatingAccount(true)}
                    className="rounded-card border border-dashed border-line p-4 text-sm text-muted hover:border-accent hover:text-ink"
                  >
                    {t('+ счёт')}
                  </button>
                </div>
              </section>
            ))}
          </div>

          {/* Quick expense entry */}
          <section className="rounded-card border border-line bg-surface p-4">
            <h2 className="eyebrow mb-3">{t('Записать трату')}</h2>
            <div className="flex flex-wrap items-end gap-3">
              <label className="block">
                <span className="mb-1.5 block text-xs text-muted">{t('Сумма')}</span>
                <input
                  inputMode="decimal"
                  value={quickAmount}
                  placeholder="0"
                  onChange={(e) => setQuickAmount(e.target.value)}
                  onKeyDown={onEnter(() => void quickAdd())}
                  className={`${field} w-28 font-mono text-lg`}
                />
              </label>

              <label className="block">
                <span className="mb-1.5 block text-xs text-muted">{t('Счёт')}</span>
                <select
                  value={quickAccount}
                  onChange={(e) => setQuickAccount(e.target.value)}
                  className={field}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => void quickAdd()}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                {t('Добавить')}
              </button>
            </div>

            <div className="mt-3 flex flex-wrap gap-2">
              {expenseCategories.map(({ category: c, depth }) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setQuickCategory(quickCategory === c.id ? '' : c.id)}
                  className={`${chip} flex items-center gap-2 ${
                    quickCategory === c.id ? chipOn : chipOff
                  }`}
                >
                  <span className="size-2 rounded-full" style={{ backgroundColor: c.color }} aria-hidden />
                  {depth === 1 && <span aria-hidden>↳</span>}
                  {c.name}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  setCategoryParent('');
                  setCreatingCategoryKind('expense');
                }}
                className={`${chip} border-dashed border-line text-muted hover:text-ink`}
              >
                {t('+ категория')}
              </button>
            </div>
            <p className="mt-2 text-xs text-muted">
              {t('Дата — сегодня. Перевод, доход или другую дату задайте кнопкой «Операция».')}
            </p>
          </section>

          <DuePanel due={due} onChanged={() => void load()} />

          {/* Month */}
          <section>
            <div className="mb-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setAnchor(addMonths(anchor, -1))}
                  aria-label={t('Предыдущий месяц')}
                  className="grid size-8 place-items-center rounded-lg border border-line text-muted hover:text-ink"
                >
                  ‹
                </button>
                <button
                  type="button"
                  onClick={() => setAnchor(today)}
                  className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-ink"
                >
                  {t('Этот месяц')}
                </button>
                <button
                  type="button"
                  onClick={() => setAnchor(addMonths(anchor, 1))}
                  aria-label={t('Следующий месяц')}
                  className="grid size-8 place-items-center rounded-lg border border-line text-muted hover:text-ink"
                >
                  ›
                </button>
              </div>
              <h2 className="font-display text-lg font-semibold text-ink">{monthTitle(anchor)}</h2>

              <div className="ml-auto flex gap-1 rounded-lg border border-line p-0.5">
                {(
                  [
                    ['operations', t('Операции')],
                    ['budgets', t('Лимиты')],
                    ['recurring', t('Регулярные')],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setTab(value)}
                    className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
                      tab === value
                        ? 'bg-accent-soft font-medium text-accent'
                        : 'text-muted hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {tab === 'budgets' && (
              <BudgetsPanel
                month={anchor.slice(0, 7)}
                monthLabel={monthTitle(anchor)}
                accounts={accounts}
                categories={categories}
              />
            )}

            {tab === 'recurring' && (
              <RecurringPanel
                accounts={accounts}
                categories={categories}
                today={today}
                onChanged={() => void load()}
              />
            )}

            {tab === 'operations' && (
            <div className="grid gap-4 lg:grid-cols-[1fr_20rem]">
              {/* Transactions */}
              <div>
                {byDate.length === 0 ? (
                  <Empty>{t('За этот месяц операций нет.')}</Empty>
                ) : (
                  <ul className="space-y-3">
                    {byDate.map(([date, items]) => (
                      <li key={date} className="overflow-hidden rounded-card border border-line bg-surface">
                        <p className="border-b border-line px-4 py-2 text-xs text-muted">
                          {formatDate(date)}
                        </p>
                        <ul>
                          {items.map((tx) => (
                            <li key={tx.id}>
                              <button
                                type="button"
                                onClick={() => setEditingTx(tx)}
                                className="flex w-full items-center gap-3 border-b border-line px-4 py-2.5 text-left last:border-0 hover:bg-surface-2"
                              >
                                <span
                                  className="size-2 shrink-0 rounded-full"
                                  style={{
                                    backgroundColor:
                                      tx.category_color ?? tx.account_color ?? 'var(--c-text-muted)',
                                  }}
                                  aria-hidden
                                />
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm text-ink">
                                    {tx.kind === 'transfer'
                                      ? `${tx.account_name} → ${tx.to_account_name}`
                                      : tx.category_name ?? tx.place ?? t('Без категории')}
                                  </span>
                                  <span className="block truncate text-xs text-muted">
                                    {tx.kind !== 'transfer' && tx.account_name}
                                    {tx.place && tx.category_name ? ` · ${tx.place}` : ''}
                                    {tx.note ? ` · ${tx.note}` : ''}
                                    {tx.receipts > 0 ? ` · ${t('чек')}` : ''}
                                  </span>
                                </span>
                                <span
                                  className={`shrink-0 font-mono text-sm ${
                                    tx.kind === 'income'
                                      ? 'text-done'
                                      : tx.kind === 'transfer'
                                        ? 'text-muted'
                                        : 'text-ink'
                                  }`}
                                >
                                  {tx.kind === 'income' ? '+' : tx.kind === 'expense' ? '−' : ''}
                                  {formatMoney(tx.amount, tx.currency)}
                                </span>
                              </button>
                            </li>
                          ))}
                        </ul>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Totals */}
              <aside className="space-y-4">
                <section className="rounded-card border border-line bg-surface p-4">
                  <h3 className="eyebrow mb-2.5">{t('Итоги месяца')}</h3>
                  {expenseTotals.length === 0 && incomeTotals.length === 0 ? (
                    <p className="text-sm text-muted">{t('Пока пусто.')}</p>
                  ) : (
                    <ul className="space-y-1.5 text-sm">
                      {incomeTotals.map((r) => (
                        <li key={`in-${r.currency}`} className="flex justify-between">
                          <span className="text-muted">{t('Доходы')}, {r.currency}</span>
                          <span className="font-mono text-done">
                            +{formatMoney(r.total, r.currency)}
                          </span>
                        </li>
                      ))}
                      {expenseTotals.map((r) => (
                        <li key={`ex-${r.currency}`} className="flex justify-between">
                          <span className="text-muted">{t('Траты')}, {r.currency}</span>
                          <span className="font-mono text-ink">
                            −{formatMoney(r.total, r.currency)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <p className="mt-3 text-xs text-muted">
                    {t('Валюты не складываются: курса в системе нет, поэтому общего итога тоже.')}
                  </p>
                </section>

                <section className="rounded-card border border-line bg-surface p-4">
                  <h3 className="eyebrow mb-2.5">{t('По категориям')}</h3>
                  {expenseByCurrency.length === 0 ? (
                    <p className="text-sm text-muted">{t('Трат за месяц нет.')}</p>
                  ) : (
                    <div className="space-y-5">
                      {expenseByCurrency.map(({ currency, rows, total }) => (
                        <div key={currency}>
                          {expenseByCurrency.length > 1 && (
                            <p className="eyebrow mb-2 text-xs">{currency}</p>
                          )}
                          <div className="mb-3 flex justify-center">
                            <DonutChart
                              segments={rows.map((r) => ({
                                value: r.total,
                                color: r.color ?? 'var(--c-text-muted)',
                                label: r.name ?? t('Без категории'),
                              }))}
                              centerLabel={formatMoney(total, currency)}
                            />
                          </div>
                          <ul className="space-y-2">
                            {rows.map((r) => {
                              const rowKey = `${currency}-${r.key}`;
                              const expanded = expandedCats.has(rowKey);
                              return (
                                <li key={rowKey} className="text-sm">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      r.children.length > 0 && toggleExpanded(rowKey)
                                    }
                                    className={`flex w-full items-center justify-between gap-2 text-left ${
                                      r.children.length > 0 ? '' : 'cursor-default'
                                    }`}
                                  >
                                    <span className="flex min-w-0 items-center gap-2">
                                      <span
                                        className="size-2 shrink-0 rounded-full"
                                        style={{
                                          backgroundColor: r.color ?? 'var(--c-text-muted)',
                                        }}
                                        aria-hidden
                                      />
                                      <span className="truncate text-ink">
                                        {r.name ?? t('Без категории')}
                                      </span>
                                      {r.children.length > 0 && (
                                        <span className="text-xs text-muted" aria-hidden>
                                          {expanded ? '▾' : '▸'}
                                        </span>
                                      )}
                                    </span>
                                    <span className="shrink-0 font-mono text-xs text-muted">
                                      {formatMoney(r.total, r.currency)}
                                    </span>
                                  </button>
                                  <p className="mt-0.5 pl-4 text-xs text-muted">
                                    {r.count} {plural(r.count, 'операция', 'операции', 'операций')}
                                    {' · '}
                                    {Math.round((r.total / total) * 100)}%
                                  </p>
                                  {expanded && (
                                    <ul className="mt-1.5 space-y-1 border-l border-line pl-4">
                                      {r.children.map((child) => (
                                        <li
                                          key={child.category_id}
                                          className="flex items-center justify-between gap-2 text-xs"
                                        >
                                          <span className="flex min-w-0 items-center gap-2">
                                            <span
                                              className="size-1.5 shrink-0 rounded-full"
                                              style={{
                                                backgroundColor:
                                                  child.color ?? 'var(--c-text-muted)',
                                              }}
                                              aria-hidden
                                            />
                                            <span className="truncate text-muted">
                                              {child.category_name}
                                            </span>
                                          </span>
                                          <span className="shrink-0 font-mono text-muted">
                                            {formatMoney(child.total, child.currency)}
                                          </span>
                                        </li>
                                      ))}
                                      {/* Remainder — spending recorded on the parent itself */}
                                      {(() => {
                                        const childSum = r.children.reduce(
                                          (sum, c) => sum + c.total,
                                          0,
                                        );
                                        const own = r.total - childSum;
                                        if (own <= 0) return null;
                                        return (
                                          <li className="flex items-center justify-between gap-2 text-xs">
                                            <span className="pl-3.5 text-muted">
                                              {t('Само по себе')}
                                            </span>
                                            <span className="shrink-0 font-mono text-muted">
                                              {formatMoney(own, r.currency)}
                                            </span>
                                          </li>
                                        );
                                      })()}
                                    </ul>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="rounded-card border border-line bg-surface p-4">
                  <h3 className="eyebrow mb-2.5">{t('Категории')}</h3>
                  <div className="flex flex-wrap gap-2">
                    {orderCategories(categories).map(({ category: c, depth }) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          setCategoryParent(c.parent_id ?? '');
                          setEditingCategory(c);
                        }}
                        className={`${chip} ${chipOff} flex items-center gap-2`}
                      >
                        <span
                          className="size-2 rounded-full"
                          style={{ backgroundColor: c.color }}
                          aria-hidden
                        />
                        {depth === 1 && <span aria-hidden>↳</span>}
                        {c.name}
                        <span className="text-xs opacity-60">
                          {c.kind === 'income' ? t('доход') : t('трата')}
                        </span>
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryParent('');
                        setCreatingCategoryKind('expense');
                      }}
                      className={`${chip} border-dashed border-line text-muted hover:text-ink`}
                    >
                      {t('+ трата')}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCategoryParent('');
                        setCreatingCategoryKind('income');
                      }}
                      className={`${chip} border-dashed border-line text-muted hover:text-ink`}
                    >
                      {t('+ доход')}
                    </button>
                  </div>
                </section>
              </aside>
            </div>
            )}
          </section>
        </div>
      )}

      {/* ── Dialogs ─────────────────────────────────────────────────────── */}

      {(creatingTx || editingTx) && accounts && accounts.length > 0 && (
        <TransactionDialog
          transaction={editingTx}
          defaultAccountId={quickAccount || accounts[0]!.id}
          accounts={accounts}
          categories={categories}
          today={today}
          onSaved={() => void load()}
          onClose={() => {
            setCreatingTx(false);
            setEditingTx(null);
          }}
        />
      )}

      {creatingAccount && (
        <EntityDialog
          title={t('Новый счёт')}
          initial={{ name: '', color: PALETTE[0], flag: false }}
          flagLabel={t('Личный')}
          flagHint={t('Операции и остаток видите только вы')}
          onSave={async (draft) => {
            await api.post('/accounts', {
              name: draft.name,
              currency: newCurrency,
              color: draft.color,
              shared: !draft.flag,
            });
            await load();
          }}
          onClose={() => setCreatingAccount(false)}
        >
          <label className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">{t('Валюта')}</span>
            <div className="flex flex-wrap gap-2">
              {COMMON_CURRENCIES.map((code) => (
                <button
                  key={code}
                  type="button"
                  onClick={() => setNewCurrency(code)}
                  className={`${chip} ${newCurrency === code ? chipOn : chipOff}`}
                >
                  {code}
                </button>
              ))}
            </div>
            <span className="mt-1 block text-xs text-muted">
              {t('Валюту потом не сменить, если по счёту уже есть операции')}
            </span>
          </label>
        </EntityDialog>
      )}

      {editingAccount && (
        <EntityDialog
          title={t('Счёт')}
          initial={{
            name: editingAccount.name,
            color: editingAccount.color,
            flag: editingAccount.shared === 0,
          }}
          flagLabel={t('Личный')}
          flagHint={t('Операции и остаток видите только вы')}
          archiveLabel={editingAccount.archived_at ? t('Вернуть из архива') : t('Убрать в архив')}
          deletable={editingAccount.tx_count === 0}
          deleteHint={t('По счёту {n} {unit}. Удаление сотрёт и их — лучше убрать счёт в архив.', {
            n: editingAccount.tx_count,
            unit: plural(editingAccount.tx_count, 'операция', 'операции', 'операций'),
          })}
          onSave={async (draft) => {
            await api.patch(`/accounts/${editingAccount.id}`, {
              name: draft.name,
              color: draft.color,
              shared: !draft.flag,
            });
            await load();
          }}
          onArchive={async () => {
            await api.post(`/accounts/${editingAccount.id}/archive`, {});
            await load();
          }}
          onDelete={async () => {
            await api.delete(`/accounts/${editingAccount.id}`);
            await load();
          }}
          onClose={() => setEditingAccount(null)}
        />
      )}

      {creatingCategoryKind && (
        <EntityDialog
          title={creatingCategoryKind === 'expense' ? t('Категория трат') : t('Категория доходов')}
          initial={{ name: '', color: PALETTE[2] }}
          onSave={async (draft) => {
            await api.post('/categories', {
              name: draft.name,
              kind: creatingCategoryKind,
              color: draft.color,
              parent_id: categoryParent || null,
            });
            await load();
          }}
          onClose={() => setCreatingCategoryKind(null)}
        >
          <CategoryParentField
            categories={categories}
            kind={creatingCategoryKind}
            value={categoryParent}
            onChange={setCategoryParent}
          />
        </EntityDialog>
      )}

      {editingCategory && (
        <EntityDialog
          title={t('Категория')}
          initial={{ name: editingCategory.name, color: editingCategory.color }}
          deletable
          onSave={async (draft) => {
            await api.patch(`/categories/${editingCategory.id}`, {
              name: draft.name,
              color: draft.color,
              parent_id: categoryParent || null,
            });
            await load();
          }}
          onDelete={async () => {
            // A category with history is hidden, not deleted — otherwise
            // past reports would lose their labeling
            await api.delete(`/categories/${editingCategory.id}`);
            await load();
          }}
          onClose={() => setEditingCategory(null)}
        >
          {/* A category with subcategories cannot itself become one —
              the server would reject it, so the select simply isn't shown */}
          {!categories.some((c) => c.parent_id === editingCategory.id) && (
            <CategoryParentField
              categories={categories}
              kind={editingCategory.kind}
              excludeId={editingCategory.id}
              value={categoryParent}
              onChange={setCategoryParent}
            />
          )}
        </EntityDialog>
      )}
    </Page>
  );
}

/** Parent-category select for the create and edit dialogs. */
function CategoryParentField({
  categories,
  kind,
  excludeId,
  value,
  onChange,
}: {
  categories: Category[];
  kind: 'expense' | 'income';
  excludeId?: string;
  value: string;
  onChange: (id: string) => void;
}) {
  // Only a top-level category of the same kind can be a parent
  const options = categories.filter(
    (c) => c.kind === kind && !c.parent_id && c.id !== excludeId,
  );
  if (options.length === 0) return null;

  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink">{t('Входит в')}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
      >
        <option value="">{t('Никуда — категория верхнего уровня')}</option>
        {options.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
      </select>
      <span className="mt-1 block text-xs text-muted">
        {t('Подкатегории сворачиваются в родителя в сводке, лимит родителя считает их траты')}
      </span>
    </label>
  );
}
