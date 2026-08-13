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
import { formatDate } from '../lib/format';
import { RECURRENCE_OPTIONS } from '../lib/tasks';
import { describeRule, normalizeRule } from '../lib/money';
import {
  TX_KIND_LABEL,
  formatAmountInput,
  orderCategories,
  formatMoney,
  parseAmount,
  type Account,
  type Category,
  type TxKind,
} from '../lib/money';

export interface DueItem {
  recurring_id: string;
  occurred_on: string;
  title: string;
  kind: TxKind;
  amount: number;
  currency: string;
  account_name: string;
  category_name: string | null;
  auto_create: number;
}

export interface Rule {
  id: string;
  title: string;
  kind: TxKind;
  start_on: string;
  recurrence_rule: string;
  account_id: string;
  account_name: string;
  currency: string;
  amount: number;
  to_account_id: string | null;
  to_amount: number | null;
  category_id: string | null;
  category_name: string | null;
  note: string | null;
  place: string | null;
  auto_create: number;
  active: number;
  created_count: number;
}

/** Panel of items awaiting confirmation — also shown on the transactions page. */
export function DuePanel({
  due,
  onChanged,
}: {
  due: DueItem[];
  onChanged: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});

  if (due.length === 0) return null;

  async function confirm(item: DueItem) {
    const key = `${item.recurring_id}#${item.occurred_on}`;
    const typed = amounts[key];
    const amount = typed ? parseAmount(typed) : null;
    await api.post(`/recurring/${item.recurring_id}/confirm`, {
      occurred_on: item.occurred_on,
      ...(amount ? { amount } : {}),
    });
    onChanged();
  }

  async function skip(item: DueItem) {
    await api.post(`/recurring/${item.recurring_id}/skip`, { occurred_on: item.occurred_on });
    onChanged();
  }

  return (
    <section className="rounded-card border border-accent bg-accent-soft/40 p-4">
      <h2 className="eyebrow mb-3">{t('Confirm')}</h2>
      <ul className="space-y-2">
        {due.map((item) => {
          const key = `${item.recurring_id}#${item.occurred_on}`;
          return (
            <li
              key={key}
              className="flex flex-wrap items-center gap-3 rounded-lg bg-surface px-3 py-2.5"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-ink">{item.title}</span>
                <span className="block text-xs text-muted">
                  {formatDate(item.occurred_on)} · {item.account_name}
                  {item.category_name ? ` · ${item.category_name}` : ''}
                </span>
              </span>

              <input
                inputMode="decimal"
                value={amounts[key] ?? formatAmountInput(item.amount)}
                onChange={(e) => setAmounts({ ...amounts, [key]: e.target.value })}
                onKeyDown={onEnter(() => void confirm(item))}
                aria-label={t('Actual amount')}
                className="w-28 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-right font-mono text-sm text-ink outline-none focus:border-accent"
              />
              <span className="text-xs text-muted">{item.currency}</span>

              <button
                type="button"
                onClick={() => void confirm(item)}
                className="rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                {t('Post')}
              </button>
              <button
                type="button"
                onClick={() => void skip(item)}
                className="text-sm text-muted underline underline-offset-2 hover:text-ink"
              >
                {t('Did not happen')}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs text-muted">
        {t('You can adjust the amount before posting: a salary with a bonus or a water bill rarely matches the plan.')}
      </p>
    </section>
  );
}

export function RecurringPanel({
  accounts,
  categories,
  today,
  onChanged,
}: {
  accounts: Account[];
  categories: Category[];
  today: string;
  onChanged: () => void;
}) {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [editing, setEditing] = useState<Rule | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setRules(await api.get<Rule[]>('/recurring'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(rule: Rule) {
    await api.patch(`/recurring/${rule.id}`, { active: rule.active === 0 });
    await load();
    onChanged();
  }

  return (
    <div className="space-y-4">
      {rules === null ? (
        <div className="h-40 animate-pulse rounded-card bg-surface-3" />
      ) : rules.length === 0 ? (
        <Empty>
          {t('No recurring transactions. Rent, subscriptions, salary — anything that repeats belongs here.')}
        </Empty>
      ) : (
        <ul className="overflow-hidden rounded-card border border-line bg-surface">
          {rules.map((r) => (
            <li
              key={r.id}
              className={`flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 last:border-0 ${
                r.active ? '' : 'opacity-50'
              }`}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium text-ink">
                  {r.title}
                  <span className="ml-2 text-xs font-normal text-muted">
                    {TX_KIND_LABEL[r.kind]}
                  </span>
                </span>
                <span className="block truncate text-xs text-muted">
                  {describeRule(r.recurrence_rule)} · {r.account_name}
                  {r.category_name ? ` · ${r.category_name}` : ''} ·{' '}
                  {r.auto_create ? t('created automatically') : t('with confirmation')}
                </span>
              </span>

              <span className="shrink-0 font-mono text-sm text-ink">
                {formatMoney(r.amount, r.currency)}
              </span>

              <button
                type="button"
                onClick={() => void toggle(r)}
                className="shrink-0 text-xs text-muted underline underline-offset-2 hover:text-ink"
              >
                {r.active ? t('Turn off') : t('Enable')}
              </button>
              <button
                type="button"
                onClick={() => setEditing(r)}
                className="shrink-0 text-xs text-accent underline underline-offset-2"
              >
                {t('Edit')}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        onClick={() => setCreating(true)}
        className="rounded-lg border border-dashed border-line px-4 py-2 text-sm text-muted hover:border-accent hover:text-ink"
      >
        {t('+ recurring transaction')}
      </button>

      {(creating || editing) && accounts.length > 0 && (
        <RuleDialog
          rule={editing}
          accounts={accounts}
          categories={categories}
          today={today}
          onSaved={async () => {
            await load();
            onChanged();
          }}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function RuleDialog({
  rule,
  accounts,
  categories,
  today,
  onSaved,
  onClose,
}: {
  rule: Rule | null;
  accounts: Account[];
  categories: Category[];
  today: string;
  onSaved: () => Promise<void> | void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState({
    title: rule?.title ?? '',
    kind: rule?.kind ?? ('expense' as TxKind),
    start_on: rule?.start_on ?? today,
    // Normalization is mandatory: the stored rule may come in the
    // "FREQ=MONTHLY;INTERVAL=1" form that matches no select option
    recurrence_rule: normalizeRule(rule?.recurrence_rule ?? 'FREQ=MONTHLY'),
    account_id: rule?.account_id ?? accounts[0]!.id,
    amount: rule ? formatAmountInput(rule.amount) : '',
    to_account_id: rule?.to_account_id ?? '',
    to_amount: rule?.to_amount ? formatAmountInput(rule.to_amount) : '',
    category_id: rule?.category_id ?? '',
    note: rule?.note ?? '',
    auto_create: rule ? rule.auto_create === 1 : false,
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.id === draft.account_id);
  const toAccount = accounts.find((a) => a.id === draft.to_account_id);
  const needsSecondAmount =
    draft.kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency;

  async function save() {
    const amount = parseAmount(draft.amount);
    if (!draft.title.trim()) {
      setError(t('Enter a name'));
      return;
    }
    if (amount === null || amount === 0) {
      setError(t('Enter an amount above zero'));
      return;
    }
    if (draft.kind === 'transfer' && !draft.to_account_id) {
      setError(t('Choose a destination account'));
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        title: draft.title.trim(),
        kind: draft.kind,
        start_on: draft.start_on,
        recurrence_rule: draft.recurrence_rule,
        account_id: draft.account_id,
        amount,
        to_account_id: draft.kind === 'transfer' ? draft.to_account_id : null,
        to_amount:
          draft.kind === 'transfer'
            ? needsSecondAmount
              ? parseAmount(draft.to_amount)
              : amount
            : null,
        category_id: draft.kind === 'transfer' ? null : draft.category_id || null,
        note: draft.note || null,
        auto_create: draft.auto_create,
      };
      if (rule) await api.patch(`/recurring/${rule.id}`, payload);
      else await api.post('/recurring', payload);
      await onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!rule) return;
    await api.delete(`/recurring/${rule.id}`);
    await onSaved();
    onClose();
  }

  return (
    <Modal
      title={rule ? t('Recurring transaction') : t('New recurring transaction')}
      width="max-w-md"
      onClose={onClose}
      onSubmit={() => {
        if (!busy) void save();
      }}
      footer={
        <>
          {rule && (
            <button type="button" onClick={() => void remove()} className={`${dialogDanger} mr-auto`}>
              {t('Delete rule')}
            </button>
          )}
          <button type="button" onClick={onClose} className={dialogGhost}>
            {t('Cancel')}
          </button>
          <button type="button" disabled={busy} onClick={() => void save()} className={dialogPrimary}>
            {t('Save')}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <label className="block">
          <span className={dialogLabel}>{t('Title')}</span>
          <input
            autoFocus
            value={draft.title}
            placeholder={t('Rent, subscription, salary')}
            onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            onKeyDown={onEnter(() => void save())}
            className={dialogField}
          />
        </label>

        <div className="flex gap-1 rounded-lg border border-line p-0.5">
          {(['expense', 'income', 'transfer'] as TxKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => setDraft({ ...draft, kind: k, category_id: '' })}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                draft.kind === k ? 'bg-accent-soft font-medium text-accent' : 'text-muted'
              }`}
            >
              {TX_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={dialogLabel}>{t('Amount')}</span>
            <input
              inputMode="decimal"
              value={draft.amount}
              placeholder="0"
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              className={`${dialogField} font-mono`}
            />
          </label>
          <label className="block">
            <span className={dialogLabel}>{t('First occurrence')}</span>
            <input
              type="date"
              value={draft.start_on}
              onChange={(e) => setDraft({ ...draft, start_on: e.target.value })}
              className={dialogField}
            />
          </label>
        </div>

        <label className="block">
          <span className={dialogLabel}>{t('Repeat')}</span>
          <select
            value={draft.recurrence_rule}
            onChange={(e) => setDraft({ ...draft, recurrence_rule: e.target.value })}
            className={dialogField}
          >
            {RECURRENCE_OPTIONS.filter((o) => o.value).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={dialogLabel}>{draft.kind === 'transfer' ? t('From account') : t('Account')}</span>
          <select
            value={draft.account_id}
            onChange={(e) => setDraft({ ...draft, account_id: e.target.value })}
            className={dialogField}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
              </option>
            ))}
          </select>
        </label>

        {draft.kind === 'transfer' && (
          <>
            <label className="block">
              <span className={dialogLabel}>{t('To account')}</span>
              <select
                value={draft.to_account_id}
                onChange={(e) => setDraft({ ...draft, to_account_id: e.target.value })}
                className={dialogField}
              >
                <option value="">{t('Choose an account')}</option>
                {accounts
                  .filter((a) => a.id !== draft.account_id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
              </select>
            </label>
            {needsSecondAmount && (
              <label className="block">
                <span className={dialogLabel}>{t('Credit')}, {toAccount.currency}</span>
                <input
                  inputMode="decimal"
                  value={draft.to_amount}
                  onChange={(e) => setDraft({ ...draft, to_amount: e.target.value })}
                  className={`${dialogField} font-mono`}
                />
              </label>
            )}
          </>
        )}

        {draft.kind !== 'transfer' && (
          <label className="block">
            <span className={dialogLabel}>{t('Category')}</span>
            <select
              value={draft.category_id}
              onChange={(e) => setDraft({ ...draft, category_id: e.target.value })}
              className={dialogField}
            >
              <option value="">{t('No category')}</option>
              {orderCategories(categories, draft.kind).map(
                ({ category: c, depth }) => (
                  <option key={c.id} value={c.id}>
                    {depth === 1 ? `\u2003↳ ${c.name}` : c.name}
                  </option>
                ),
              )}
            </select>
          </label>
        )}

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={draft.auto_create}
            onChange={(e) => setDraft({ ...draft, auto_create: e.target.checked })}
            className="mt-0.5 size-4 accent-[var(--c-accent)]"
          />
          <span>
            <span className="block text-sm text-ink">{t('Create automatically')}</span>
            <span className="block text-xs text-muted">
              {t('Good for rent that is charged on time. Salary is better confirmed: it arrives late, and recording it ahead of time would skew the balance')}
            </span>
          </span>
        </label>

        {error && <p className="text-sm text-urgent">{error}</p>}
      </div>
    </Modal>
  );
}
