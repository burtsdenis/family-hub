import { t } from '../lib/i18n';
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  Modal,
  dialogDanger,
  dialogField,
  dialogGhost,
  dialogLabel,
  dialogPrimary,
} from './Dialog';
import { Empty } from './Page';
import { onEnter } from '../lib/keys';
import {
  formatAmountInput,
  formatMoney,
  orderCategories,
  parseAmount,
  type Account,
  type Category,
} from '../lib/money';

export interface Budget {
  budget_id: string;
  category_id: string;
  category_name: string;
  color: string;
  currency: string;
  limit_amount: number;
  limit_month: string | null;
  spent: number;
}

interface Props {
  month: string;
  monthLabel: string;
  accounts: Account[];
  categories: Category[];
}

export function BudgetsPanel({ month, monthLabel, accounts, categories }: Props) {
  const [budgets, setBudgets] = useState<Budget[] | null>(null);
  const [editing, setEditing] = useState<Budget | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBudgets(await api.get<Budget[]>(`/budgets?month=${month}`));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Не удалось загрузить лимиты'));
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const currencies = [...new Set(accounts.map((a) => a.currency))];
  const expenseCategories = categories.filter((c) => c.kind === 'expense');

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-urgent bg-urgent/10 px-4 py-2.5 text-sm text-ink">
          {error}
        </p>
      )}

      {budgets === null ? (
        <div className="h-40 animate-pulse rounded-card bg-surface-3" />
      ) : budgets.length === 0 ? (
        <Empty>
          {t('Лимитов нет. Поставьте лимит на категорию — и станет видно, сколько от него осталось.')}
        </Empty>
      ) : (
        <ul className="space-y-3">
          {budgets.map((b) => {
            const left = b.limit_amount - b.spent;
            const share = Math.min(100, Math.round((b.spent / b.limit_amount) * 100));
            const over = left < 0;
            return (
              <li key={b.budget_id} className="rounded-card border border-line bg-surface p-4">
                <div className="flex items-baseline justify-between gap-3">
                  <button
                    type="button"
                    onClick={() => setEditing(b)}
                    className="flex min-w-0 items-center gap-2 text-left"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: b.color }}
                      aria-hidden
                    />
                    <span className="truncate text-sm font-medium text-ink">{b.category_name}</span>
                    {b.limit_month && (
                      <span className="shrink-0 text-xs text-muted">{t('только этот месяц')}</span>
                    )}
                  </button>

                  <span className={`shrink-0 font-mono text-sm ${over ? 'text-urgent' : 'text-ink'}`}>
                    {over ? t('перерасход ') : t('осталось ')}
                    {formatMoney(Math.abs(left), b.currency)}
                  </span>
                </div>

                <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
                  <div
                    className={`h-full ${over ? 'bg-urgent' : share > 80 ? 'bg-urgent/60' : 'bg-accent'}`}
                    style={{ width: `${share}%` }}
                  />
                </div>

                <p className="mt-2 font-mono text-xs text-muted">
                  {formatMoney(b.spent, b.currency)} {t('из')} {formatMoney(b.limit_amount, b.currency)}
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="rounded-lg border border-dashed border-line px-4 py-2 text-sm text-muted hover:border-accent hover:text-ink"
      >
        {t('+ лимит')}
      </button>

      {(creating || editing) && (
        <BudgetDialog
          budget={editing}
          month={month}
          monthLabel={monthLabel}
          currencies={currencies}
          categories={expenseCategories}
          onSaved={() => void load()}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function BudgetDialog({
  budget,
  month,
  monthLabel,
  currencies,
  categories,
  onSaved,
  onClose,
}: {
  budget: Budget | null;
  month: string;
  monthLabel: string;
  currencies: string[];
  categories: Category[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [categoryId, setCategoryId] = useState(budget?.category_id ?? categories[0]?.id ?? '');
  const [currency, setCurrency] = useState(budget?.currency ?? currencies[0] ?? 'EUR');
  const [amount, setAmount] = useState(budget ? formatAmountInput(budget.limit_amount) : '');
  const [onlyThisMonth, setOnlyThisMonth] = useState(Boolean(budget?.limit_month));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    const value = parseAmount(amount);
    if (value === null || value === 0) {
      setError(t('Укажите сумму лимита'));
      return;
    }
    if (!categoryId) {
      setError(t('Сначала заведите категорию трат'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.put('/budgets', {
        category_id: categoryId,
        currency,
        month: onlyThisMonth ? month : null,
        amount: value,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Не удалось сохранить'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!budget) return;
    await api.delete(`/budgets/${budget.budget_id}`);
    onSaved();
    onClose();
  }

  return (
    <Modal
      title={budget ? t('Лимит') : t('Новый лимит')}
      onClose={onClose}
      onSubmit={() => {
        if (!busy) void save();
      }}
      footer={
        <>
          {budget && (
            <button type="button" onClick={() => void remove()} className={`${dialogDanger} mr-auto`}>
              {t('Убрать')}
            </button>
          )}
          <button type="button" onClick={onClose} className={dialogGhost}>
            {t('Отмена')}
          </button>
          <button type="button" disabled={busy} onClick={() => void save()} className={dialogPrimary}>
            {t('Сохранить')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={dialogLabel}>{t('Категория')}</span>
          <select
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={Boolean(budget)}
            className={`${dialogField} disabled:opacity-60`}
          >
            {orderCategories(categories).map(({ category: c, depth }) => (
              <option key={c.id} value={c.id}>
                {depth === 1 ? `\u2003↳ ${c.name}` : c.name}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-xs text-muted">
            {t('Лимит на родительскую категорию учитывает и траты её подкатегорий')}
          </span>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={dialogLabel}>{t('Лимит на месяц')}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={amount}
              placeholder="0"
              onChange={(e) => setAmount(e.target.value)}
              onKeyDown={onEnter(() => void save())}
              className={`${dialogField} font-mono`}
            />
          </label>

          <label className="block">
            <span className={dialogLabel}>{t('Валюта')}</span>
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              disabled={Boolean(budget)}
              className={`${dialogField} disabled:opacity-60`}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={onlyThisMonth}
            onChange={(e) => setOnlyThisMonth(e.target.checked)}
            className="mt-0.5 size-4 accent-[var(--c-accent)]"
          />
          <span>
            <span className="block text-sm text-ink">{t('Только на')} {monthLabel.toLowerCase()}</span>
            <span className="block text-xs text-muted">
              {t('Разовое исключение. В остальных месяцах останется постоянный лимит')}
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-urgent">{error}</p>}
      </div>
    </Modal>
  );
}
