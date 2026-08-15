import { lang, setLang, t } from '../lib/i18n';
import { setWeekStart, weekStart } from '../lib/format';
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useDialogs } from '../components/Dialog';
import { plural } from '../lib/format';
import { Page } from '../components/Page';
import { onEnter } from '../lib/keys';
import { PALETTE, addToPalette, loadCustomPalette, removeFromPalette } from '../lib/palette';
import { PeopleSection } from '../components/PeopleSection';
import { MailSection } from '../components/MailSection';

/**
 * The hub's custom colors on top of the stock palette. The list also grows
 * from the color pickers in entity dialogs; this is where it gets pruned.
 */
function PaletteSection() {
  const [custom, setCustom] = useState<string[] | null>(null);
  // The native color input fires change per drag tick — debounce the save
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    void loadCustomPalette()
      .then(setCustom)
      .catch(() => setCustom([]));
  }, []);

  function add(color: string) {
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void addToPalette(color).then(setCustom);
    }, 800);
  }

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="eyebrow mb-3">{t('Palette')}</h2>
      <p className="mb-3 text-xs text-muted">
        {t('Your own colors for projects, accounts, categories and calendars — on top of the stock ones. Grows from here and from the "+" button right in the color picker.')}
      </p>

      <div className="flex flex-wrap items-center gap-2">
        {PALETTE.map((color) => (
          <span
            key={color}
            className="size-7 rounded-full opacity-60"
            style={{ backgroundColor: color }}
            title={t('Stock color')}
          />
        ))}
        {(custom ?? []).map((color) => (
          <button
            key={color}
            type="button"
            onClick={() => void removeFromPalette(color).then(setCustom)}
            style={{ backgroundColor: color }}
            title={t('Remove {color}', { color })}
            aria-label={t('Remove {color}', { color })}
            className="group relative size-7 rounded-full"
          >
            <span className="absolute inset-0 grid place-items-center rounded-full bg-black/40 text-xs text-white opacity-0 transition-opacity group-hover:opacity-100">
              ×
            </span>
          </button>
        ))}
        <label
          className="grid size-7 cursor-pointer place-items-center rounded-full border border-dashed border-line text-sm text-muted transition-colors hover:border-accent hover:text-accent"
          title={t('Add color')}
        >
          +
          <input
            type="color"
            onChange={(e) => add(e.target.value)}
            className="sr-only"
            aria-label={t('Add color')}
          />
        </label>
      </div>
    </section>
  );
}

/** Messages after returning from Google during linking — the code is in ?google= */
const LINK_MESSAGES: Record<string, string> = {
  linked: t('Google linked. You can now use the button on the sign-in screen.'),
  taken: t('This Google account is already linked to another account.'),
  error: t('Could not link Google. Please try again.'),
};

/**
 * Sign-in methods. The rules are server-side, this is only their mirror:
 * the password can be disabled only with Google linked and never for the
 * admin; Google cannot be unlinked while the password is disabled.
 */
function SignInSection() {
  const { user, refresh } = useAuth();
  const dialogs = useDialogs();
  const [status, setStatus] = useState<string | null>(null);
  const [googleAvailable, setGoogleAvailable] = useState(false);

  useEffect(() => {
    void api
      .get<{ google: boolean }>('/auth/state')
      .then((s) => setGoogleAvailable(s.google))
      .catch(() => {});
    const code = new URLSearchParams(window.location.search).get('google');
    if (code && LINK_MESSAGES[code]) {
      setStatus(LINK_MESSAGES[code]);
      window.history.replaceState(null, '', '/settings');
    }
  }, []);

  if (!user) return null;
  const linked = Boolean(user.google_linked);
  const passwordOff = Boolean(user.password_login_disabled);

  async function run(action: () => Promise<unknown>) {
    setStatus(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('Could not save'));
    }
  }

  const rowButton =
    'rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2';

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="eyebrow mb-4">{t('Signing in')}</h2>

      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-ink">Google</p>
          <p className="text-xs text-muted">
            {linked ? t('Linked') : googleAvailable ? t('Not linked') : t('Not configured on the server')}
          </p>
        </div>
        {googleAvailable && !linked && (
          <button
            type="button"
            className={rowButton}
            onClick={() => {
              window.location.href = '/api/auth/google/link';
            }}
          >
            {t('Link')}
          </button>
        )}
        {linked && (
          <button
            type="button"
            className={rowButton}
            disabled={passwordOff}
            title={passwordOff ? t('Enable password sign-in first') : undefined}
            onClick={() => void run(() => api.post('/auth/google/unlink', {}))}
          >
            {t('Unlink')}
          </button>
        )}
      </div>

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
        <div>
          <p className="text-sm font-medium text-ink">{t('Password sign-in')}</p>
          <p className="text-xs text-muted">
            {user.role === 'admin'
              ? t('Cannot be disabled for the administrator: it is the emergency entrance')
              : passwordOff
                ? t('Disabled — sign-in via Google only')
                : linked
                  ? t('Enabled. You may disable it: Google is more secure')
                  : t('Enabled. Can be disabled once Google is linked')}
          </p>
        </div>
        {user.role !== 'admin' && (passwordOff || linked) && (
          <button
            type="button"
            className={rowButton}
            onClick={() =>
              void run(async () => {
                if (!passwordOff) {
                  const sure = await dialogs.confirm({
                    title: t('Disable password sign-in?'),
                    message: t('You will only be able to sign in with Google. If the Google account becomes unavailable, the administrator can restore access by resetting your password.'),
                    confirmLabel: t('Disable'),
                  });
                  if (!sure) return;
                }
                await api.post('/auth/password-login', { enabled: passwordOff });
              })
            }
          >
            {passwordOff ? t('Enable') : t('Disable')}
          </button>
        )}
      </div>

      {status && <p className="mt-3 text-sm text-muted">{status}</p>}
    </section>
  );
}

const FIELDS: { key: string; label: string; hint: string; type: string }[] = [
  { key: 'move.label', label: t('Event name'), hint: t('Board title'), type: 'text' },
  { key: 'move.target_date', label: t('Moving date'), hint: t('The countdown counts from it'), type: 'date' },
  { key: 'savings.label', label: t('Savings caption'), hint: '', type: 'text' },
  { key: 'savings.goal_eur', label: t('Goal, €'), hint: t('Zero — hide the progress bar'), type: 'number' },
  {
    key: 'money.default_currency',
    label: t('Default currency'),
    hint: t('Pre-filled for new accounts and budgets. Any ISO 4217 code'),
    type: 'text',
  },
];

export function Settings() {
  const { user } = useAuth();
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [usage, setUsage] = useState<{ used: number; files: number; budget: number } | null>(
    null,
  );

  useEffect(() => {
    void api.get<Record<string, string>>('/settings').then(setValues);
    void api
      .get<{ used: number; files: number; budget: number }>('/attachments/usage')
      .then(setUsage);
  }, []);

  async function save() {
    if (!values) return;
    setStatus(null);
    try {
      await api.patch('/settings', values);
      setStatus(t('Saved'));
    } catch {
      setStatus(t('Could not save'));
    }
  }

  if (!values) {
    return (
      <Page title={t('Settings')}>
        <div className="h-40 animate-pulse rounded-card bg-surface-3" />
      </Page>
    );
  }

  return (
    <Page title={t('Settings')} eyebrow={t('Board and widgets')}>
      {/* Two columns on wide screens: a single narrow ribbon left the right
          half empty and forced scrolling. Below lg — one column of the old
          max-w-md width (without the cap the forms stretched across the
          whole max-w-4xl on tablets), same section order. mx-auto because
          a capped block hugs the left edge while every other page centers. */}
      <div className="mx-auto grid max-w-md items-start gap-5 lg:max-w-4xl lg:grid-cols-2">
      <div className="space-y-5 rounded-card border border-line bg-surface p-5">
        {FIELDS.map((f) => (
          <label key={f.key} className="block">
            <span className="mb-1.5 block text-sm font-medium text-ink">{f.label}</span>
            <input
              type={f.type}
              value={values[f.key] ?? ''}
              onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
              onKeyDown={onEnter(() => void save())}
              className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
            />
            {f.hint && <span className="mt-1 block text-xs text-muted">{f.hint}</span>}
          </label>
        ))}

        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => void save()}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            {t('Save')}
          </button>
          {status && <span className="text-sm text-muted">{status}</span>}
        </div>
      </div>

      <div className="space-y-5">
      <section className="rounded-card border border-line bg-surface p-5">
        <h2 className="eyebrow mb-4">{t('Language')} / Language</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => lang !== 'en' && setLang('en')}
            className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
              lang === 'en' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'
            }`}
          >
            English
          </button>
          <button
            type="button"
            onClick={() => lang !== 'ru' && setLang('ru')}
            className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
              lang === 'ru' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'
            }`}
          >
            Русский
          </button>
        </div>
        <p className="mt-3 text-xs text-muted">
          {t('A per-device setting: a phone and the shared kiosk can speak different languages.')}
        </p>

        <h2 className="eyebrow mt-6 mb-4">{t('Week starts on')}</h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => weekStart !== 'mon' && setWeekStart('mon')}
            className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
              weekStart === 'mon' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {t('Monday')}
          </button>
          <button
            type="button"
            onClick={() => weekStart !== 'sun' && setWeekStart('sun')}
            className={`rounded-lg border px-4 py-2 text-sm transition-colors ${
              weekStart === 'sun' ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted hover:text-ink'
            }`}
          >
            {t('Sunday')}
          </button>
        </div>
      </section>

      <PaletteSection />

      <SignInSection />

      {usage && (
        <section className="rounded-card border border-line bg-surface p-5">
          <h2 className="eyebrow mb-3">{t('Attachments')}</h2>
          <p className="text-sm text-ink">
            {usage.files} {plural(usage.files, 'file', 'files')} ·{' '}
            {(usage.used / 1024 / 1024).toFixed(1)} {t('MB')}
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full bg-accent"
              style={{ width: `${Math.min(100, (usage.used / usage.budget) * 100).toFixed(2)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-muted">
            {t('The guideline is {n} GB. There is no hard limit, but keep an eye on growth: attachments are not part of the GitHub backup.', { n: Math.round(usage.budget / 1024 / 1024 / 1024) })}
          </p>
        </section>
      )}

      </div>

      {/* People management spans both columns: it is a rare-visit admin
          block, wide lists inside, and user feedback asked for exactly
          this instead of a dedicated navigation section */}
      {user?.role === 'admin' && (
        <div className="lg:col-span-2">
          <MailSection />
        </div>
      )}
      {user?.role === 'admin' && (
        <div className="lg:col-span-2">
          <PeopleSection />
        </div>
      )}
      </div>
    </Page>
  );
}
