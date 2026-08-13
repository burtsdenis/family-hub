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
      setError(t('Введите сумму в евро, например 4500'));
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
      setError(t('Не удалось сохранить. Проверьте, что сервер запущен'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-card bg-[#131c24] text-[#e8eae5] shadow-sm">
      <div className="grid divide-y divide-white/10 sm:grid-cols-[1.1fr_1fr] sm:divide-x sm:divide-y-0">
        {/* Countdown */}
        <div className="px-6 py-5">
          <p className="eyebrow text-white/45!">{settings['move.label'] ?? t('Переезд')}</p>
          {days === null ? (
            <p className="mt-3 text-sm text-white/60">
              {t('Дата переезда не задана. Укажите её в настройках, и здесь появится отсчёт.')}
            </p>
          ) : (
            <>
              <p className="mt-2 flex items-baseline gap-2.5">
                <span className="font-display text-[3.25rem] leading-none font-bold tabular-nums">
                  {Math.abs(days)}
                </span>
                <span className="font-mono text-sm text-white/55">
                  {days >= 0
                    ? plural(days, 'день', 'дня', 'дней')
                    : t('{unit} назад', { unit: plural(Math.abs(days), 'день', 'дня', 'дней') })}
                </span>
              </p>
              <p className="mt-2 font-mono text-xs text-white/40">{formatDate(targetDate)}</p>
            </>
          )}
        </div>

        {/* Savings */}
        <div className="px-6 py-5">
          <p className="eyebrow text-white/45!">{settings['savings.label'] ?? t('Накоплено')}</p>

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
                  className="w-36 rounded-md border border-white/25 bg-white/5 px-2.5 py-1.5 font-mono text-lg tabular-nums outline-none focus:border-white/60"
                  aria-label={t('Сумма в евро')}
                />
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="rounded-md bg-white/15 px-3 py-1.5 text-sm hover:bg-white/25 disabled:opacity-50"
                >
                  {saving ? t('Сохраняю') : t('Сохранить')}
                </button>
              </div>
              {error && <p className="mt-2 text-xs text-[#d9a04f]">{error}</p>}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(String(saved));
                setEditing(true);
              }}
              className="mt-2 block text-left"
              aria-label={t('Изменить накопленную сумму')}
            >
              <span className="font-display text-[2.5rem] leading-none font-bold tabular-nums">
                {formatEur(saved)}
              </span>
              {goal > 0 && (
                <span className="ml-2 font-mono text-xs text-white/40">{t('из')} {formatEur(goal)}</span>
              )}
            </button>
          )}

          {progress !== null && !editing && (
            <div className="mt-3.5 h-1 overflow-hidden rounded-full bg-white/12">
              <div className="h-full bg-[#4d9ebb]" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
