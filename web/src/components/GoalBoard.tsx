import { t } from '../lib/i18n';
import { useState } from 'react';
import { api } from '../lib/api';
import { daysUntil, formatDate, plural } from '../lib/format';
import { formatAmountInput, formatMoney, parseAmount } from '../lib/money';

interface Props {
  settings: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
}

/** Minor units, missing or unparsable settings read as zero. */
function amount(settings: Record<string, string>, key: string): number {
  const value = Number(settings[key] ?? 0);
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/**
 * The money half exists once there is a target to reach: the saved
 * amount is typed on the board itself, and a family that only wants a
 * countdown should not have to look at a zero.
 */
function hasMoney(settings: Record<string, string>): boolean {
  return amount(settings, 'goal.target') > 0 || amount(settings, 'goal.saved') > 0;
}

/** An unset goal is no widget at all, not an empty card asking to be filled. */
export function hasGoal(settings: Record<string, string>): boolean {
  return daysUntil(settings['goal.date'] ?? '') !== null || hasMoney(settings);
}

/**
 * A goal the family is heading towards: a date to count down to, an
 * amount to save up, or both. The one loud element in the interface —
 * everything around it is deliberately quiet.
 */
export function GoalBoard({ settings, onChange }: Props) {
  const targetDate = settings['goal.date'] ?? '';
  const days = daysUntil(targetDate);
  const saved = amount(settings, 'goal.saved');
  const target = amount(settings, 'goal.target');
  const progress = target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : null;
  /*
    The goal keeps its own currency because currencies are never
    converted here: reading the amount through the default-currency
    setting would relabel euros as dinars the day that setting changes.
  */
  const currency = (
    settings['goal.currency']?.trim() ||
    settings['money.default_currency']?.trim() ||
    'EUR'
  ).toUpperCase();

  const showCountdown = days !== null;
  const showMoney = hasMoney(settings);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(() => formatAmountInput(saved));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = parseAmount(draft);
    if (parsed === null) {
      setError(t('Enter an amount, e.g. 4500'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch = { 'goal.saved': String(parsed) };
      await api.patch('/settings', patch);
      onChange(patch);
      setEditing(false);
    } catch {
      setError(t('Could not save. Check that the server is running'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface shadow-sm">
      <div
        className={`grid divide-y divide-line ${
          showCountdown && showMoney
            ? 'sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:divide-x sm:divide-y-0'
            : ''
        }`}
      >
        {showCountdown && (
          <div className="px-6 py-5">
            <p className="eyebrow">{settings['goal.title'] || t('Goal')}</p>
            <p className="mt-2 flex items-baseline gap-2.5">
              <span className="font-display text-[3.25rem] leading-none font-bold tabular-nums">
                {Math.abs(days)}
              </span>
              <span className="font-mono text-sm text-muted">
                {days >= 0
                  ? plural(days, 'day', 'days')
                  : t('{unit} ago', { unit: plural(Math.abs(days), 'day', 'days') })}
              </span>
            </p>
            <p className="mt-2 font-mono text-xs text-muted">{formatDate(targetDate)}</p>
          </div>
        )}

        {showMoney && (
          <div className="px-6 py-5">
            {/* Without a countdown the money side is the whole card, so it
                carries the goal's name; beside one it is just a caption. */}
            <p className="eyebrow">
              {settings['goal.saved_label'] ||
                (showCountdown ? '' : settings['goal.title']) ||
                t('Saved so far')}
            </p>

            {editing ? (
              <div className="mt-2.5">
                <div className="flex items-center gap-2">
                  <input
                    autoFocus
                    inputMode="decimal"
                    // The amount is almost always retyped, not appended to.
                    // Without select-all, "4500" plus a typed 7 became 45007.
                    onFocus={(e) => e.currentTarget.select()}
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void save();
                      if (e.key === 'Escape') setEditing(false);
                    }}
                    className="w-36 rounded-md border border-line bg-surface-2 px-2.5 py-1.5 font-mono text-lg tabular-nums outline-none focus:border-accent"
                    aria-label={t('Amount')}
                  />
                  <button
                    type="button"
                    onClick={() => void save()}
                    disabled={saving}
                    className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
                  >
                    {saving ? t('Saving') : t('Save')}
                  </button>
                </div>
                {error && <p className="mt-2 text-xs text-urgent">{error}</p>}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  // Machine format, never the localized one: the English
                  // locale's thousands comma is not parseable back.
                  setDraft(formatAmountInput(saved));
                  setEditing(true);
                }}
                className="mt-2 block text-left"
                aria-label={t('Edit the saved amount')}
              >
                <span className="font-display text-[2.5rem] leading-none font-bold tabular-nums">
                  {formatMoney(saved, currency)}
                </span>
                {target > 0 && (
                  <span className="ml-2 font-mono text-xs text-muted">
                    {t('of')} {formatMoney(target, currency)}
                  </span>
                )}
              </button>
            )}

            {progress !== null && !editing && (
              <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-surface-3">
                <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
