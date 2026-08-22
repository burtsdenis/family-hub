import { Link } from 'react-router-dom';
import { useState } from 'react';
import { t } from '../lib/i18n';
import { api } from '../lib/api';
import { reportFailure } from '../lib/failures';
import { daysUntil, formatDate, plural } from '../lib/format';
import { formatMoney, type Outlook } from '../lib/money';

type Row = Outlook['currencies'][number];
type Bill = Row['bills'][number];

const billKey = (b: Bill): string => `${b.recurring_id}#${b.date}`;

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="size-3.5"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

/** "In 9 days", "today", "2 days ago" — an income can be late and unconfirmed. */
function when(date: string): string {
  const days = daysUntil(date) ?? 0;
  if (days === 0) return t('today');
  // plural() returns the word alone — the count has to be spelled out
  const unit = `${Math.abs(days)} ${plural(Math.abs(days), 'day', 'days')}`;
  return days > 0 ? t('in {unit}', { unit }) : t('{unit} ago', { unit });
}

/**
 * A dashboard tile, not a ledger: a long list of standing orders would
 * push everything below it off the screen. The total underneath still
 * counts every one of them.
 */
const BILLS_SHOWN = 5;

function CurrencyBlock({
  row,
  today,
  onPosted,
}: {
  row: Row;
  today: string;
  onPosted: () => void;
}) {
  const shown = row.bills.slice(0, BILLS_SHOWN);
  const hidden = row.bills.length - shown.length;
  const [posting, setPosting] = useState<string | null>(null);

  /*
    A bill whose day has come can be ticked off here: the same confirm
    the pending list in Money uses, at the planned amount. An amount that
    turned out different is a trip to Money — this is a dashboard tile,
    not a form.

    The remainder below does not move when a bill is posted, and that is
    the point: the money leaves the balance and leaves the list with it.
  */
  async function post(bill: Bill) {
    setPosting(billKey(bill));
    try {
      await api.post(`/recurring/${bill.recurring_id}/confirm`, { occurred_on: bill.date });
      onPosted();
    } catch (err) {
      reportFailure(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setPosting(null);
    }
  }

  return (
    <div>
      <p className="font-display text-2xl font-bold tabular-nums">
        {formatMoney(row.balance, row.currency)}
      </p>

      {row.next_income && (
        <p className="mt-1 flex items-baseline justify-between gap-3 text-xs">
          <span className="min-w-0 truncate text-muted">
            {row.next_income.title} · {formatDate(row.next_income.date)}
          </span>
          <span className="shrink-0 font-mono text-muted tabular-nums">
            {when(row.next_income.date)}
          </span>
        </p>
      )}

      {row.bills.length > 0 && (
        <>
          <ul className="mt-2.5 space-y-0.5">
            {shown.map((b) => {
              // Only a bill whose date has arrived can be posted: confirming
              // one that has not happened yet would take the money out of
              // the balance days before it actually leaves.
              const payable = b.date <= today;
              const line = (
                <>
                  <span className="min-w-0 truncate text-ink">{b.title}</span>
                  <span className="flex shrink-0 items-baseline gap-2 font-mono tabular-nums">
                    <span className={payable ? 'text-accent' : 'text-muted'}>
                      {formatDate(b.date)}
                    </span>
                    <span className="text-ink">−{formatMoney(b.amount, row.currency)}</span>
                    <span className="w-3.5 self-center text-accent">
                      {payable && (
                        <span className="opacity-0 transition-opacity group-hover/bill:opacity-100 [@media(hover:none)]:opacity-100">
                          <CheckIcon />
                        </span>
                      )}
                    </span>
                  </span>
                </>
              );
              return (
                <li key={billKey(b)}>
                  {payable ? (
                    <button
                      type="button"
                      onClick={() => void post(b)}
                      disabled={posting === billKey(b)}
                      title={t('Post')}
                      className="group/bill -mx-1.5 flex w-full items-baseline justify-between gap-3 rounded-md px-1.5 py-1 text-left text-xs transition-colors hover:bg-surface-2 disabled:opacity-50"
                    >
                      {line}
                    </button>
                  ) : (
                    <div className="-mx-1.5 flex items-baseline justify-between gap-3 px-1.5 py-1 text-xs">
                      {line}
                    </div>
                  )}
                </li>
              );
            })}
            {hidden > 0 && (
              <li className="px-0 pt-1 text-xs text-muted">
                {t('more')} {hidden}
              </li>
            )}
          </ul>
          {/* The number the widget exists for: what the balance becomes
              once everything already scheduled has left it. */}
          <p className="mt-2.5 flex items-baseline justify-between gap-3 border-t border-line pt-2 text-xs">
            <span className="text-muted">{t('Left')}</span>
            <span
              className={`font-mono font-medium tabular-nums ${
                row.left < 0 ? 'text-urgent' : 'text-ink'
              }`}
            >
              {formatMoney(row.left, row.currency)}
            </span>
          </p>
        </>
      )}
    </div>
  );
}

/**
 * Not "how much is there" — the accounts screen answers that — but how
 * much of it is already spoken for before the next money arrives: the
 * spendable balance, the wait for the next income, and the standing
 * payments that fall in between.
 *
 * One block per currency, in the order the server ranked them; nothing
 * is converted, so there is no grand total to show.
 */
export function BalancePanel({
  outlook,
  onPosted,
}: {
  outlook: Outlook;
  /** A bill was posted: the balance and the list have both changed. */
  onPosted: () => void;
}) {
  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3">
      <header className="flex items-baseline justify-between">
        <h2 className="eyebrow">{t('Balance')}</h2>
        <Link to="/money" className="font-mono text-xs text-muted transition-colors hover:text-ink">
          {t('Money')} →
        </Link>
      </header>
      <div className="mt-2 space-y-4 pb-1">
        {outlook.currencies.map((row) => (
          <CurrencyBlock
            key={row.currency}
            row={row}
            today={outlook.today}
            onPosted={onPosted}
          />
        ))}
      </div>
    </section>
  );
}
