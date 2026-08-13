import { t } from '../lib/i18n';
import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState, type ReactNode } from 'react';
import { useAuth } from '../lib/auth';
import { QuickAdd } from './QuickAdd';
import { GlobalSearch } from './GlobalSearch';

interface NavItem {
  to: string;
  label: string;
  icon: ReactNode;
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

const NAV: NavItem[] = [
  {
    to: '/',
    label: t('Сегодня'),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M4 11 12 4l8 7" />
        <path d="M6 10v9h12v-9" />
      </svg>
    ),
  },
  {
    to: '/tasks',
    label: t('Задачи'),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M4 7h10M4 12h10M4 17h6" />
        <path d="m17 6 2 2 3-3" />
      </svg>
    ),
  },
  {
    to: '/calendar',
    label: t('Календарь'),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
        <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
      </svg>
    ),
  },
  {
    to: '/notes',
    label: t('Заметки'),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
        <path d="M14.5 3.5V8h4.5M9 13h6M9 16.5h4" />
      </svg>
    ),
  },
  {
    to: '/money',
    label: t('Деньги'),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <rect x="3" y="6.5" width="18" height="12" rx="2" />
        <circle cx="12" cy="12.5" r="2.5" />
        <path d="M6.5 12.5h.01M17.5 12.5h.01" />
      </svg>
    ),
  },
];

/** Разделы, которым место не в основном ряду. */
const SECONDARY: NavItem[] = [
  {
    to: '/settings',
    label: t('Настройки'),
    icon: (
      <svg viewBox="0 0 24 24" {...stroke}>
        <circle cx="12" cy="12" r="3" />
        <path d="M12 3.5v2.2M12 18.3v2.2M20.5 12h-2.2M5.7 12H3.5M18 6l-1.6 1.6M7.6 16.4 6 18M18 18l-1.6-1.6M7.6 7.6 6 6" />
      </svg>
    ),
  },
];

const ADMIN_NAV: NavItem = {
  to: '/users',
  label: t('Пользователи'),
  icon: (
    <svg viewBox="0 0 24 24" {...stroke}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
      <path d="M16 5.4a3.2 3.2 0 0 1 0 5.2M17.5 14.6c1.9.5 3 2.2 3 4.4" />
    </svg>
  ),
};

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('hub.theme');
    if (saved) return saved === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    localStorage.setItem('hub.theme', dark ? 'dark' : 'light');
  }, [dark]);

  return { dark, toggle: () => setDark((v) => !v) };
}

function ThemeToggle() {
  const { dark, toggle } = useTheme();
  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-full border border-line p-2 text-muted transition-colors hover:text-ink"
      aria-label={dark ? t('Включить светлую тему') : t('Включить тёмную тему')}
    >
      <svg viewBox="0 0 24 24" className="size-4" {...stroke}>
        {dark ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M22 12h-2M4 12H2M18.4 5.6 17 7M7 17l-1.4 1.4M18.4 18.4 17 17M7 7 5.6 5.6" />
          </>
        ) : (
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z" />
        )}
      </svg>
    </button>
  );
}

export function AppShell() {
  const { user, logout } = useAuth();
  // Задача, добавленная из любого места, должна сразу появиться в открытом разделе
  const [refreshKey, setRefreshKey] = useState(0);
  // Поиском управляет оболочка: на телефоне его открывает нижняя панель,
  // а боковой панели там нет вовсе.
  const [searchOpen, setSearchOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const sidebarNav = [
    ...NAV,
    ...SECONDARY,
    ...(user?.role === 'admin' ? [ADMIN_NAV] : []),
  ];

  return (
    <div className="min-h-dvh md:flex">
      {/* Боковая навигация: ноутбук и стенд.
          Липкая и со своим скроллом: на длинном списке задач страница
          прокручивается, а панель с разделами остаётся на месте. */}
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface px-4 py-6 md:sticky md:top-0 md:flex md:h-dvh md:overflow-y-auto 3xl:w-64">
        {/* Переключатель темы живёт в шапке: рядом с «Выйти» по нему
            мисклики разлогинивали — цена промаха несоразмерна кнопке */}
        <div className="mb-8 flex items-center justify-between px-2">
          <span className="font-display text-lg font-bold tracking-tight text-ink">{t('Дом')}</span>
          <ThemeToggle />
        </div>

        <div className="mb-4">
          <GlobalSearch open={searchOpen} onOpenChange={setSearchOpen} />
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {sidebarNav.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                [
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors',
                  isActive
                    ? 'bg-accent-soft font-medium text-accent'
                    : 'text-muted hover:bg-surface-2 hover:text-ink',
                ].join(' ')
              }
            >
              <span className="size-5 shrink-0">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="space-y-3 border-t border-line pt-4">
          <div className="flex items-center gap-2.5 px-2">
            <span
              className="size-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: user?.color ?? 'var(--c-accent)' }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-sm text-ink">{user?.name}</span>
          </div>
          <div className="px-2">
            <button
              type="button"
              onClick={() => void logout()}
              className="rounded-lg px-2.5 py-1.5 text-sm text-muted transition-colors hover:text-ink"
            >
              {t('Выйти')}
            </button>
          </div>
        </div>
      </aside>

      {/* Контент */}
      <main className="flex-1 pb-20 md:pb-0">
        <Outlet key={refreshKey} />
      </main>

      <QuickAdd onAdded={() => setRefreshKey((k) => k + 1)} />

      {/* Нижняя навигация: телефон */}
      <nav className="fixed inset-x-0 bottom-0 z-10 grid grid-cols-6 border-t border-line bg-surface pb-[env(safe-area-inset-bottom)] md:hidden">
        {NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              [
                'flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] transition-colors',
                isActive ? 'text-accent' : 'text-muted',
              ].join(' ')
            }
          >
            <span className="size-5">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}

        {/* Шестым пунктом — всё, что не влезло: поиск, настройки, пользователи */}
        <button
          type="button"
          onClick={() => setMoreOpen((v) => !v)}
          className={`flex flex-col items-center gap-1 py-2.5 text-[0.6875rem] ${
            moreOpen ? 'text-accent' : 'text-muted'
          }`}
        >
          <svg viewBox="0 0 24 24" className="size-5" {...stroke}>
            <circle cx="5" cy="12" r="1.2" />
            <circle cx="12" cy="12" r="1.2" />
            <circle cx="19" cy="12" r="1.2" />
          </svg>
          {t('Ещё')}
        </button>
      </nav>

      {moreOpen && (
        <div className="fixed inset-0 z-20 md:hidden">
          <button
            type="button"
            aria-label={t('Закрыть')}
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 bg-black/40"
          />
          <div className="absolute inset-x-0 bottom-0 rounded-t-card border-t border-line bg-surface pb-[env(safe-area-inset-bottom)]">
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                setSearchOpen(true);
              }}
              className="flex w-full items-center gap-3 border-b border-line px-5 py-3.5 text-sm text-ink"
            >
              <svg viewBox="0 0 24 24" className="size-5 text-muted" {...stroke}>
                <circle cx="11" cy="11" r="6.5" />
                <path d="m16 16 4 4" />
              </svg>
              {t('Поиск')}
            </button>

            {[...SECONDARY, ...(user?.role === 'admin' ? [ADMIN_NAV] : [])].map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMoreOpen(false)}
                className="flex w-full items-center gap-3 border-b border-line px-5 py-3.5 text-sm text-ink last:border-0"
              >
                <span className="size-5 text-muted">{item.icon}</span>
                {item.label}
              </NavLink>
            ))}

            <div className="flex items-center justify-between px-5 py-3.5">
              <span className="text-sm text-muted">{user?.name}</span>
              <button
                type="button"
                onClick={() => void logout()}
                className="text-sm text-muted underline underline-offset-2"
              >
                {t('Выйти')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
