import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Empty } from './Page';
import { onEnter } from '../lib/keys';
import { clearBlankOnBlur } from '../lib/forms';
import { EntityDialog } from './EntityDialog';
import { useDialogs } from './Dialog';

interface ManagedUser {
  id: string;
  email: string;
  name: string;
  role: 'admin' | 'member' | 'kid';
  color: string;
  last_login_at: string | null;
  disabled_at: string | null;
  must_change_password: number;
}

const ROLE_LABEL: Record<ManagedUser['role'], string> = {
  admin: t('Администратор'),
  member: t('Житель дома'),
  kid: t('Ребёнок'),
};

/** The password is shown exactly once — after that only the owner knows it. */
function PasswordOnce({ password, onClose }: { password: string; onClose: () => void }) {
  return (
    <div className="mb-5 rounded-card border border-accent bg-accent-soft p-4">
      <p className="text-sm font-medium text-ink">{t('Пароль создан. Он показывается один раз.')}</p>
      <p className="my-3 font-mono text-lg tracking-wide text-ink select-all">{password}</p>
      <p className="text-xs text-muted">
        {t('Передайте его владельцу учётки. При первом входе система попросит задать свой пароль.')}
      </p>
      <button
        type="button"
        onClick={onClose}
        className="mt-3 text-sm font-medium text-accent underline underline-offset-2"
      >
        {t('Записал, скрыть')}
      </button>
    </div>
  );
}

interface Invite {
  id: string;
  role: string;
  created_at: string;
  expires_at: string;
  used: number;
  used_by_name: string | null;
}

/**
 * Invite links are the primary way to add a household member:
 * the person fills in their own name, login and password — nothing to dictate.
 * The link is single-use, lives a week and is shown once.
 */
function InvitesBlock() {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [freshLink, setFreshLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  async function load() {
    setInvites(await api.get<Invite[]>('/invites'));
  }

  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy(true);
    try {
      const { path } = await api.post<{ id: string; path: string }>('/invites', {});
      setFreshLink(window.location.origin + path);
      setCopied(false);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function copy(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Clipboard unavailable (non-HTTPS or denied) — the link is on screen, they'll copy it by hand
    }
  }

  const pending = (invites ?? []).filter((i) => !i.used);

  return (
    <div className="mb-6 rounded-card border border-line bg-surface p-5">
      <h2 className="eyebrow mb-4">{t('Пригласить по ссылке')}</h2>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => void create()}
          disabled={busy}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {t('Создать ссылку')}
        </button>
        <p className="text-xs text-muted">
          {t('Одноразовая, действует неделю. Отправьте её домочадцу — остальное он заполнит сам.')}
        </p>
      </div>

      {freshLink && (
        <div className="mt-4 flex items-center gap-2 rounded-lg border border-line bg-surface-2 p-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs text-ink">{freshLink}</code>
          <button
            type="button"
            onClick={() => void copy(freshLink)}
            className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-ink hover:bg-surface-3"
          >
            {copied ? t('Скопировано') : t('Копировать')}
          </button>
        </div>
      )}

      {pending.length > 0 && (
        <ul className="mt-4 space-y-2">
          {pending.map((i) => (
            <li key={i.id} className="flex items-center justify-between text-sm">
              <span className="text-muted">
                {t('Ссылка от {from} · действует до {to}', { from: i.created_at.slice(0, 10), to: i.expires_at.slice(0, 10) })}
              </span>
              <button
                type="button"
                onClick={() => void api.delete(`/invites/${i.id}`).then(load)}
                className="text-xs text-muted underline decoration-line hover:text-urgent"
              >
                {t('Отозвать')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * People management, formerly a standalone /users page. User feedback:
 * managing the household happens a few times a year — it does not deserve
 * a navigation item. It now lives in Settings (admin only) and spans both
 * columns there.
 */
export function PeopleSection() {
  const [users, setUsers] = useState<ManagedUser[] | null>(null);
  const [password, setPassword] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', email: '', role: 'member' as ManagedUser['role'] });
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ManagedUser | null>(null);
  const dialogs = useDialogs();

  const load = () => api.get<ManagedUser[]>('/users').then(setUsers).catch(() => setUsers([]));
  useEffect(() => {
    void load();
  }, []);

  async function create() {
    setBusy(true);
    setError(null);
    try {
      const res = await api.post<{ password: string }>('/users', form);
      setPassword(res.password);
      setForm({ name: '', email: '', role: 'member' });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Не удалось создать пользователя'));
    } finally {
      setBusy(false);
    }
  }

  async function reset(user: ManagedUser) {
    const ok = await dialogs.confirm({
      title: t('Сбросить пароль'),
      message: t('{name} будет разлогинен на всех устройствах и получит новый пароль.', { name: user.name }),
      confirmLabel: t('Сбросить'),
    });
    if (!ok) return;
    const res = await api.post<{ password: string }>(`/users/${user.id}/reset-password`, {});
    setPassword(res.password);
    await load();
  }

  async function toggle(user: ManagedUser) {
    await api.post(`/users/${user.id}/toggle`, {});
    await load();
  }

  return (
    <section>
      <h2 className="eyebrow mb-4">{t('Пользователи')}</h2>
      <InvitesBlock />

      {password && <PasswordOnce password={password} onClose={() => setPassword(null)} />}

      <div className="mb-6 rounded-card border border-line bg-surface p-5">
        <h2 className="eyebrow mb-4">{t('Создать вручную (с одноразовым паролем)')}</h2>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
          <input
            placeholder={t('Имя')}
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            onBlur={clearBlankOnBlur(() => setForm({ ...form, name: '' }))}
            onKeyDown={onEnter(() => void create())}
            className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <input
            placeholder={t('имя@hub.local')}
            autoCapitalize="none"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            onBlur={clearBlankOnBlur(() => setForm({ ...form, email: '' }))}
            onKeyDown={onEnter(() => void create())}
            className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={() => void create()}
            disabled={busy}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {t('Создать')}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-urgent">{error}</p>}
      </div>

      {users === null ? (
        <div className="h-32 animate-pulse rounded-card bg-surface-3" />
      ) : users.length === 0 ? (
        <Empty>{t('Пользователей нет.')}</Empty>
      ) : (
        <ul className="overflow-hidden rounded-card border border-line bg-surface">
          {users.map((u) => (
            <li
              key={u.id}
              className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line px-4 py-3.5 last:border-0"
            >
              <span
                className="size-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: u.color }}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">
                  {u.name}
                  {u.disabled_at && <span className="ml-2 text-xs text-muted">{t('отключён')}</span>}
                </p>
                <p className="truncate font-mono text-xs text-muted">{u.email}</p>
              </div>
              <span className="text-xs text-muted">{ROLE_LABEL[u.role]}</span>
              <button
                type="button"
                onClick={() => setEditing(u)}
                className="text-xs text-accent underline underline-offset-2"
              >
                {t('Изменить')}
              </button>
              <button
                type="button"
                onClick={() => void reset(u)}
                className="text-xs text-accent underline underline-offset-2"
              >
                {t('Сбросить пароль')}
              </button>
              <button
                type="button"
                onClick={() => void toggle(u)}
                className="text-xs text-muted underline underline-offset-2 hover:text-ink"
              >
                {u.disabled_at ? t('Включить') : t('Отключить')}
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <EntityDialog
          title={t('Пользователь')}
          initial={{ name: editing.name, color: editing.color }}
          onSave={async (draft) => {
            await api.patch(`/users/${editing.id}`, { name: draft.name, color: draft.color });
            await load();
          }}
          onClose={() => setEditing(null)}
        />
      )}

      <p className="mt-5 text-sm text-muted">
        {t('Администратор управляет учётками и настройками, но не видит чужие приватные заметки — выборки фильтруются по владельцу без исключений для роли.')}
      </p>
    </section>
  );
}
