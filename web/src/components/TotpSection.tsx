import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const codeField =
  'w-40 rounded-lg border border-line bg-surface-2 px-3 py-2 text-center font-mono text-lg tracking-widest text-ink outline-none focus:border-accent';
const button =
  'rounded-lg border border-line px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-2';

/**
 * Two-factor authentication for password sign-in (TOTP). Exists mostly
 * for the administrator: family members can hide behind Google and its
 * MFA, but the admin's password entrance can never be disabled — it is
 * the emergency door, and a door like that deserves a second lock.
 * The escape hatch for a lost authenticator is `npm run admin:reset`,
 * which clears TOTP along with the password.
 */
export function TotpSection() {
  const { user, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; uri: string; qr: string } | null>(null);
  const [code, setCode] = useState('');
  const [disabling, setDisabling] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const enabled = Boolean(user?.totp_enabled);

  useEffect(() => {
    setStatus(null);
    setError(null);
  }, [enabled]);

  async function begin() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ secret: string; uri: string }>('/auth/totp/setup', {});
      const qr = await QRCode.toDataURL(res.uri, { margin: 1, width: 192 });
      setSetup({ ...res, qr });
      setCode('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/totp/confirm', { code: code.trim() });
      setSetup(null);
      setCode('');
      setStatus(t('Two-factor authentication is on. Codes are now required at password sign-in.'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setError(null);
    try {
      await api.post('/auth/totp/disable', { code: code.trim() });
      setDisabling(false);
      setCode('');
      setStatus(t('Two-factor authentication is off.'));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Could not save'));
    } finally {
      setBusy(false);
    }
  }

  if (!user) return null;

  return (
    <section className="rounded-card border border-line bg-surface p-5">
      <h2 className="eyebrow mb-2">{t('Two-factor authentication')}</h2>
      <p className="mb-4 text-xs text-muted">
        {t('A second lock on password sign-in: a six-digit code from an authenticator app (Google Authenticator, 1Password, …). Recommended for the administrator — that account cannot hide behind Google.')}
      </p>

      {!enabled && !setup && (
        <button type="button" onClick={() => void begin()} disabled={busy} className={button}>
          {t('Enable')}
        </button>
      )}

      {!enabled && setup && (
        <div className="space-y-3">
          <p className="text-sm text-ink">{t('1. Scan the QR code with the authenticator app:')}</p>
          <img
            src={setup.qr}
            alt={t('QR code for the authenticator app')}
            className="size-48 rounded-lg border border-line bg-white p-2"
          />
          <p className="text-xs text-muted">
            {t('No camera at hand? Enter the key manually:')}{' '}
            <code className="font-mono text-ink select-all">{setup.secret}</code>
          </p>
          <p className="text-sm text-ink">{t('2. Enter the code the app shows:')}</p>
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={codeField}
            />
            <button
              type="button"
              onClick={() => void confirm()}
              disabled={busy || code.length !== 6}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {t('Turn on')}
            </button>
            <button
              type="button"
              onClick={() => {
                setSetup(null);
                setCode('');
              }}
              className="text-sm text-muted hover:text-ink"
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {enabled && !disabling && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-done">{t('On — password sign-in asks for a code')}</p>
          <button type="button" onClick={() => setDisabling(true)} className={button}>
            {t('Disable')}
          </button>
        </div>
      )}

      {enabled && disabling && (
        <div className="space-y-3">
          <p className="text-sm text-ink">
            {t('Enter a current code to confirm — turning it off requires the phone, not just this session.')}
          </p>
          <div className="flex items-center gap-2">
            <input
              inputMode="numeric"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              className={codeField}
            />
            <button
              type="button"
              onClick={() => void disable()}
              disabled={busy || code.length !== 6}
              className="rounded-lg border border-urgent/40 bg-urgent/10 px-4 py-2 text-sm font-medium text-urgent hover:opacity-90 disabled:opacity-50"
            >
              {t('Disable')}
            </button>
            <button
              type="button"
              onClick={() => {
                setDisabling(false);
                setCode('');
              }}
              className="text-sm text-muted hover:text-ink"
            >
              {t('Cancel')}
            </button>
          </div>
        </div>
      )}

      {status && <p className="mt-3 text-sm text-done">{status}</p>}
      {error && <p className="mt-3 text-sm text-urgent">{error}</p>}
      <p className="mt-3 text-xs text-muted">
        {t('Lost the authenticator? The server owner runs npm run admin:reset — it resets the password and removes the second factor.')}
      </p>
    </section>
  );
}
