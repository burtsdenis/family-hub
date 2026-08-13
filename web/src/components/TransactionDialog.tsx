import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import {
  Modal,
  dialogDanger,
  dialogField,
  dialogGhost,
  dialogLabel,
  dialogPrimary,
} from './Dialog';
import { onEnter } from '../lib/keys';
import { shrinkAll } from '../lib/image';
import {
  TX_KIND_LABEL,
  formatAmountInput,
  orderCategories,
  parseAmount,
  type Account,
  type Category,
  type Transaction,
  type TxKind,
} from '../lib/money';

interface Props {
  transaction: Transaction | null;
  defaultAccountId: string;
  defaultKind?: TxKind;
  accounts: Account[];
  categories: Category[];
  today: string;
  onSaved: () => void;
  onClose: () => void;
}

export function TransactionDialog({
  transaction,
  defaultAccountId,
  defaultKind = 'expense',
  accounts,
  categories,
  today,
  onSaved,
  onClose,
}: Props) {
  const editing = transaction !== null;

  const [kind, setKind] = useState<TxKind>(transaction?.kind ?? defaultKind);
  const [draft, setDraft] = useState({
    occurred_on: transaction?.occurred_on ?? today,
    account_id: transaction?.account_id ?? defaultAccountId,
    amount: transaction ? formatAmountInput(transaction.amount) : '',
    to_account_id: transaction?.to_account_id ?? '',
    to_amount: transaction?.to_amount ? formatAmountInput(transaction.to_amount) : '',
    category_id: transaction?.category_id ?? '',
    note: transaction?.note ?? '',
    place: transaction?.place ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [receipts, setReceipts] = useState<
    { id: string; filename: string; size_bytes: number; is_image: number }[]
  >([]);
  const [uploading, setUploading] = useState(false);

  // Receipts are fetched only for an existing transaction: there is
  // nothing to attach to an unsaved one
  useEffect(() => {
    if (!transaction) return;
    void api
      .get<typeof receipts>(`/transactions/${transaction.id}/attachments`)
      .then(setReceipts)
      .catch(() => {});
  }, [transaction]);

  async function uploadReceipts(files: File[]) {
    if (!transaction || files.length === 0) return;
    setUploading(true);
    try {
      // A receipt photo weighs several megabytes, yet all we need from it is the amount and date
      const shrunk = await shrinkAll(files);
      const form = new FormData();
      for (const file of shrunk) form.append('file', file);

      const res = await fetch(`/api/transactions/${transaction.id}/attachments`, {
        method: 'POST',
        body: form,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? t('Не удалось загрузить чек'));
        return;
      }
      setReceipts(await api.get<typeof receipts>(`/transactions/${transaction.id}/attachments`));
      onSaved();
    } finally {
      setUploading(false);
    }
  }

  async function removeReceipt(receiptId: string) {
    await api.delete(`/attachments/${receiptId}`);
    setReceipts(receipts.filter((r) => r.id !== receiptId));
    onSaved();
  }

  const account = accounts.find((a) => a.id === draft.account_id);
  const toAccount = accounts.find((a) => a.id === draft.to_account_id);
  // Currencies are unlinked: for a transfer between different currencies
  // the second amount is entered by hand, because the system has no exchange rate
  const needsSecondAmount =
    kind === 'transfer' && account && toAccount && account.currency !== toAccount.currency;

  const visibleCategories = orderCategories(categories, kind === 'transfer' ? undefined : kind);

  async function save() {
    const amount = parseAmount(draft.amount);
    if (amount === null || amount === 0) {
      setError(t('Укажите сумму больше нуля'));
      return;
    }

    let toAmount: number | null = null;
    if (kind === 'transfer') {
      if (!draft.to_account_id) {
        setError(t('Выберите счёт получателя'));
        return;
      }
      toAmount = needsSecondAmount ? parseAmount(draft.to_amount) : amount;
      if (toAmount === null || toAmount === 0) {
        setError(t('Укажите полученную сумму'));
        return;
      }
    }

    setBusy(true);
    setError(null);
    try {
      const payload = {
        kind,
        occurred_on: draft.occurred_on,
        account_id: draft.account_id,
        amount,
        to_account_id: kind === 'transfer' ? draft.to_account_id : null,
        to_amount: kind === 'transfer' ? toAmount : null,
        category_id: kind === 'transfer' ? null : draft.category_id || null,
        note: draft.note || null,
        place: draft.place || null,
      };
      if (editing) await api.patch(`/transactions/${transaction.id}`, payload);
      else await api.post('/transactions', payload);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Не удалось сохранить'));
      setBusy(false);
    }
  }

  async function remove() {
    if (!transaction) return;
    await api.delete(`/transactions/${transaction.id}`);
    onSaved();
    onClose();
  }

  return (
    <Modal
      title={editing ? t('Операция') : t('Новая операция')}
      width="max-w-md"
      onClose={onClose}
      onSubmit={() => {
        if (!busy) void save();
      }}
      footer={
        <>
          {editing && (
            <button
              type="button"
              onClick={() => void remove()}
              className={`${dialogDanger} mr-auto`}
            >
              {t('Удалить')}
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
        <div className="flex gap-1 rounded-lg border border-line p-0.5">
          {(['expense', 'income', 'transfer'] as TxKind[]).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => {
                setKind(k);
                setDraft((d) => ({ ...d, category_id: '' }));
              }}
              className={`flex-1 rounded-md px-3 py-1.5 text-sm transition-colors ${
                kind === k ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-ink'
              }`}
            >
              {TX_KIND_LABEL[k]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={dialogLabel}>{kind === 'transfer' ? t('Списать') : t('Сумма')}</span>
            <input
              autoFocus
              inputMode="decimal"
              value={draft.amount}
              placeholder="0"
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
              onKeyDown={onEnter(() => void save())}
              className={`${dialogField} font-mono text-lg`}
            />
            {account && <span className="mt-1 block text-xs text-muted">{account.currency}</span>}
          </label>

          <label className="block">
            <span className={dialogLabel}>{t('Дата')}</span>
            <input
              type="date"
              value={draft.occurred_on}
              onChange={(e) => setDraft({ ...draft, occurred_on: e.target.value })}
              className={dialogField}
            />
          </label>
        </div>

        <label className="block">
          <span className={dialogLabel}>{kind === 'transfer' ? t('Со счёта') : t('Счёт')}</span>
          <select
            value={draft.account_id}
            onChange={(e) => setDraft({ ...draft, account_id: e.target.value })}
            className={dialogField}
          >
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} · {a.currency}
                {a.shared ? '' : t(' · личный')}
              </option>
            ))}
          </select>
        </label>

        {kind === 'transfer' && (
          <>
            <label className="block">
              <span className={dialogLabel}>{t('На счёт')}</span>
              <select
                value={draft.to_account_id}
                onChange={(e) => setDraft({ ...draft, to_account_id: e.target.value })}
                className={dialogField}
              >
                <option value="">{t('Выберите счёт')}</option>
                {accounts
                  .filter((a) => a.id !== draft.account_id)
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                      {a.shared ? '' : t(' · личный')}
                    </option>
                  ))}
              </select>
            </label>

            {needsSecondAmount && (
              <label className="block">
                <span className={dialogLabel}>{t('Зачислить')}, {toAccount.currency}</span>
                <input
                  inputMode="decimal"
                  value={draft.to_amount}
                  placeholder="0"
                  onChange={(e) => setDraft({ ...draft, to_amount: e.target.value })}
                  className={`${dialogField} font-mono`}
                />
                <span className="mt-1 block text-xs text-muted">
                  {t('Валюты разные, а курса в системе нет — введите, сколько пришло по факту')}
                </span>
              </label>
            )}
          </>
        )}

        {kind !== 'transfer' && (
          <div>
            <span className={dialogLabel}>{t('Категория')}</span>
            {visibleCategories.length === 0 ? (
              <p className="text-sm text-muted">
                {t('Категорий этого вида пока нет — их можно завести на странице денег.')}
              </p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {visibleCategories.map(({ category: c, depth }) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() =>
                      setDraft({ ...draft, category_id: draft.category_id === c.id ? '' : c.id })
                    }
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                      draft.category_id === c.id
                        ? 'border-accent bg-accent-soft text-accent'
                        : 'border-line text-muted hover:text-ink'
                    }`}
                  >
                    <span
                      className="size-2 rounded-full"
                      style={{ backgroundColor: c.color }}
                      aria-hidden
                    />
                    {depth === 1 && <span aria-hidden>↳</span>}
                    {c.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className={dialogLabel}>{t('Где')}</span>
            <input
              value={draft.place}
              onChange={(e) => setDraft({ ...draft, place: e.target.value })}
              className={dialogField}
            />
          </label>
          <label className="block">
            <span className={dialogLabel}>{t('Заметка')}</span>
            <input
              value={draft.note}
              onChange={(e) => setDraft({ ...draft, note: e.target.value })}
              onKeyDown={onEnter(() => void save())}
              className={dialogField}
            />
          </label>
        </div>

        {editing && (
          <div>
            <span className={dialogLabel}>{t('Чек')}</span>
            <div className="flex flex-wrap items-center gap-3">
              <label className="cursor-pointer rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-ink">
                {uploading ? t('Загружаю…') : t('Приложить')}
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    const files = Array.from(e.target.files ?? []);
                    e.target.value = '';
                    void uploadReceipts(files);
                  }}
                />
              </label>

              {receipts.map((r) => (
                <span key={r.id} className="flex items-center gap-2">
                  {r.is_image ? (
                    <a href={`/api/attachments/${r.id}`} target="_blank" rel="noreferrer">
                      <img
                        src={`/api/attachments/${r.id}`}
                        alt={r.filename}
                        className="size-10 rounded border border-line object-cover"
                      />
                    </a>
                  ) : (
                    <a
                      href={`/api/attachments/${r.id}?download=true`}
                      className="text-sm text-accent underline underline-offset-2"
                    >
                      {r.filename}
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() => void removeReceipt(r.id)}
                    aria-label={t('Убрать чек')}
                    className="text-xs text-muted hover:text-urgent"
                  >
                    ✕
                  </button>
                </span>
              ))}
            </div>
            <p className="mt-1 text-xs text-muted">
              {t('Снимок уменьшается перед отправкой — читать с чека нужно сумму и дату')}
            </p>
          </div>
        )}

        {!editing && (
          <p className="text-xs text-muted">{t('Чек можно приложить после сохранения операции.')}</p>
        )}

        {error && <p className="text-sm text-urgent">{error}</p>}
      </div>
    </Modal>
  );
}
