import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { onEnter } from '../lib/keys';

/*
  The guest wishlist page (#68) — the hub's only screen for people
  without an account. Rendered outside AppShell (no navigation, no
  session), reached by an unguessable link the owner hands out.

  It deliberately does not use lib/api: the shared client's 401 handling
  belongs to the signed-in app, and this page must never trigger it.
  Reserved items show a flag with no name — a guest page must not
  enumerate the family; the names live inside the hub.
*/

interface GuestWish {
  id: string;
  title: string;
  url: string | null;
  reserved: boolean;
}

const field =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent';

export function PublicWishlist() {
  const { token } = useParams<{ token: string }>();
  const [name, setName] = useState<string | null>(null);
  const [wishes, setWishes] = useState<GuestWish[]>([]);
  const [dead, setDead] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [guestName, setGuestName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/wishlist/${token}`);
    if (!res.ok) {
      setDead(true);
      return;
    }
    const body = (await res.json()) as { name: string; wishes: GuestWish[] };
    setName(body.name);
    setWishes(body.wishes);
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function claim(wishId: string) {
    if (!guestName.trim()) {
      setError(t('Enter your name'));
      return;
    }
    setError(null);
    const res = await fetch(`/api/wishlist/${token}/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ wish_id: wishId, name: guestName.trim() }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(body?.error ?? t('Could not save'));
    }
    setClaiming(null);
    await load();
  }

  return (
    <div className="flex min-h-dvh items-start justify-center bg-surface-2 px-5 py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow mb-1 text-center">{t('Wishlist')}</p>
        {dead ? (
          <div className="rounded-card border border-line bg-surface p-6 text-center text-sm text-muted">
            {t('This link is no longer valid')}
          </div>
        ) : name === null ? (
          <div className="h-40 animate-pulse rounded-card bg-surface-3" />
        ) : (
          <>
            <h1 className="mb-5 text-center font-display text-2xl font-semibold text-ink">{name}</h1>
            <div className="rounded-card border border-line bg-surface p-5">
              {wishes.length === 0 && (
                <p className="text-sm text-muted">{t('Nothing wished for yet.')}</p>
              )}
              <ul className="space-y-3">
                {wishes.map((w) => (
                  <li key={w.id} className="flex items-center gap-3 text-sm">
                    <span className="min-w-0 flex-1">
                      {w.url ? (
                        <a
                          href={w.url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-accent underline underline-offset-2"
                        >
                          {w.title}
                        </a>
                      ) : (
                        <span className="text-ink">{w.title}</span>
                      )}
                    </span>
                    {w.reserved ? (
                      <span className="shrink-0 rounded-full border border-line px-2.5 py-1 text-xs text-muted">
                        {t('Reserved')}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setClaiming(claiming === w.id ? null : w.id)}
                        className="shrink-0 rounded-full border border-accent px-2.5 py-1 text-xs text-accent hover:bg-accent-soft"
                      >
                        {t('Reserve')}
                      </button>
                    )}
                  </li>
                ))}
              </ul>

              {claiming && (
                <div className="mt-4 border-t border-line pt-3">
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-muted">
                      {t('Your name — so the family knows who has it covered')}
                    </span>
                    <div className="flex gap-2">
                      <input
                        autoFocus
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        onKeyDown={onEnter(() => void claim(claiming))}
                        className={field}
                      />
                      <button
                        type="button"
                        onClick={() => void claim(claiming)}
                        className="shrink-0 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90"
                      >
                        {t('Reserve')}
                      </button>
                    </div>
                  </label>
                </div>
              )}
              {error && <p className="mt-3 text-sm text-urgent">{error}</p>}
            </div>
            <p className="mt-3 text-center text-xs text-muted">
              {t('Reservations are a surprise: {name} does not see them.', { name })}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
