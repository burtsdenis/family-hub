import { t } from '../lib/i18n';
import { useState } from 'react';
import { api } from '../lib/api';
import { daysUntil, formatDate, formatEur, plural } from '../lib/format';

interface Props {
  settings: Record<string, string>;
  onChange: (patch: Record<string, string>) => void;
}

/**
 * The move board is the one loud element in the interface.
 * Everything around it is deliberately quiet.
 */
export function MoveBoard({ settings, onChange }: Props) {
  const targetDate = settings['move.target_date'] ?? '';
  const days = daysUntil(targetDate);
  const saved = Number(settings['savings.amount_eur'] ?? 0);
  const goal = Number(settings['savings.goal_eur'] ?? 0);
  const progress = goal > 0 ? Math.min(100, Math.round((saved / goal) * 100)) : null;

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(String(saved));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    const parsed = Number(draft.replace(/\s/g, '').replace(',', '.'));
    if (!Number.isFinite(parsed) || parsed < 0) {
      setError(t('Enter an amount in euros, e.g. 4500'));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const patch = { 'savings.amount_eur': String(Math.round(parsed)) };
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
      <div className="grid divide-y divide-line sm:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] sm:divide-x sm:divide-y-0">
        {/* Countdown */}
        <div className="px-6 py-5">
          <p className="eyebrow">{settings['move.label'] ?? t('The move')}</p>
          {days === null ? (
            <p className="mt-3 text-sm text-muted">
              {t('The moving date is not set. Add it in Settings and a countdown will appear here.')}
            </p>
          ) : (
            <>
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
            </>
          )}
        </div>

        {/* Savings */}
        <div className="px-6 py-5">
          <p className="eyebrow">{settings['savings.label'] ?? t('Saved so far')}</p>

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
                  aria-label={t('Amount in euros')}
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
                setDraft(String(saved));
                setEditing(true);
              }}
              className="mt-2 block text-left"
              aria-label={t('Edit the saved amount')}
            >
              <span className="font-display text-[2.5rem] leading-none font-bold tabular-nums">
                {formatEur(saved)}
              </span>
              {goal > 0 && (
                <span className="ml-2 font-mono text-xs text-muted">{t('of')} {formatEur(goal)}</span>
              )}
            </button>
          )}

          {progress !== null && !editing && (
            <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full bg-accent" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
