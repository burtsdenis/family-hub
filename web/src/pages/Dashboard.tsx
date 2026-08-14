import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type Dashboard as DashboardData, type Task } from '../lib/api';
import type { Occurrence } from '../lib/calendar';
import { formatDate, timeOf } from '../lib/format';
import { effectiveDate } from '../lib/tasks';
import { MoveBoard } from '../components/MoveBoard';
import { Page } from '../components/Page';

const PRIORITY_LABEL: Record<Task['priority'], string> = {
  low: t('Low'),
  normal: t('Normal'),
  high: t('High'),
  urgent: t('Urgent'),
};

/*
  Every dashboard row leads to where something can be done about it.
  A task opens its card, an event the calendar at the right date, a note
  the note itself. Showing a list with nowhere to go is a dead end.
*/
function TaskRow({ task, overdue }: { task: Task; overdue?: boolean }) {
  return (
    <li className="border-b border-line last:border-0">
      <Link
        to={`/tasks?open=${task.id}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: task.project_color ?? 'var(--c-accent)' }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{task.title}</span>
      {task.priority === 'urgent' && (
        <span className="shrink-0 rounded-full border border-urgent/40 bg-urgent/10 px-2 py-0.5 font-mono text-[0.625rem] tracking-wide text-urgent uppercase">
          {PRIORITY_LABEL.urgent}
        </span>
      )}
        {overdue && effectiveDate(task) && (
          <span className="font-mono text-xs text-urgent">{formatDate(effectiveDate(task)!)}</span>
        )}
      </Link>
    </li>
  );
}

function EventRow({ occurrence }: { occurrence: Occurrence }) {
  const time = timeOf(occurrence.starts_at);
  return (
    <li className="border-b border-line last:border-0">
      <Link
        to={`/calendar?date=${occurrence.date}`}
        className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2">
      <span
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: occurrence.calendar_color }}
        aria-hidden
      />
      <span className="min-w-0 flex-1 truncate text-sm text-ink">
        {occurrence.title}
        {occurrence.age !== null && <span className="ml-2 text-muted">{occurrence.age}</span>}
      </span>
      {occurrence.participants.length > 0 && (
        <span
          className="flex shrink-0 -space-x-1"
          title={occurrence.participants.map((p) => p.name).join(', ')}
        >
          {occurrence.participants.slice(0, 3).map((p) => (
            <span
              key={p.id}
              className="grid size-5 place-items-center rounded-full text-[0.625rem] font-medium text-white ring-1 ring-surface"
              style={{ backgroundColor: p.color }}
            >
              {p.name.slice(0, 1)}
            </span>
          ))}
        </span>
      )}
      {occurrence.location && (
        <span className="hidden truncate text-xs text-muted sm:inline">{occurrence.location}</span>
      )}
        <span className="font-mono text-xs text-muted">{time || t('all day')}</span>
      </Link>
    </li>
  );
}

/**
 * Quick actions — phone only. On the phone the home screen is opened to
 * jot something down on the go: a task, an expense, a note. Three big
 * buttons solve that in one tap; on wide screens Cmd+K and the section
 * buttons play that role.
 */
function QuickActions() {
  const navigate = useNavigate();
  const action =
    'flex flex-col items-center gap-2 rounded-card border border-line bg-surface py-4 text-sm text-ink transition-colors active:bg-surface-2';
  const iconProps = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };

  return (
    <div className="grid grid-cols-3 gap-3 md:hidden">
      <button
        type="button"
        onClick={() => window.dispatchEvent(new Event('hub:quick-add'))}
        className={action}
      >
        <svg viewBox="0 0 24 24" className="size-6 text-accent" {...iconProps}>
          <path d="M4 7h10M4 12h10M4 17h6" />
          <path d="M18 14v6M15 17h6" />
        </svg>
        {t('Task')}
      </button>
      <button type="button" onClick={() => navigate('/money?add=1')} className={action}>
        <svg viewBox="0 0 24 24" className="size-6 text-accent" {...iconProps}>
          <rect x="3" y="6.5" width="14" height="11" rx="2" />
          <circle cx="10" cy="12" r="2.2" />
          <path d="M19 12v6M16 15h6" />
        </svg>
        {t('Expense')}
      </button>
      <button type="button" onClick={() => navigate('/notes?new=1')} className={action}>
        <svg viewBox="0 0 24 24" className="size-6 text-accent" {...iconProps}>
          <path d="M6 3.5h9l4 4V20a.5.5 0 0 1-.5.5h-12A.5.5 0 0 1 6 20V4a.5.5 0 0 1 .5-.5Z" />
          <path d="M9 12h6M12 9v6" />
        </svg>
        {t('Note')}
      </button>
    </div>
  );
}

function Panel({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-card border border-line bg-surface">
      <header className="flex items-baseline justify-between px-4 py-3">
        <h2 className="eyebrow">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="font-mono text-xs text-muted tabular-nums">{count}</span>
        )}
      </header>
      {children}
    </section>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () =>
      api
        .get<DashboardData>('/dashboard')
        .then((d) => alive && setData(d))
        .catch((e: Error) => alive && setError(e.message));

    void load();
    // The kiosk stays open for days — refresh ourselves, no page reload.
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error) {
    return (
      <Page title={t('Today')}>
        <div className="rounded-card border border-urgent/40 bg-urgent/10 px-4 py-3 text-sm text-ink">
          {error}. {t('Check that the hub server is running, then reload the page.')}
        </div>
      </Page>
    );
  }

  if (!data) {
    return (
      <Page title={t('Today')}>
        <div className="h-28 animate-pulse rounded-card bg-surface-3" />
      </Page>
    );
  }

  const nothingToday = data.dueToday.length === 0 && data.overdue.length === 0;

  return (
    <Page title={t('Today')} eyebrow={formatDate(data.today)}>
      <div className="space-y-5">
        <QuickActions />

        <MoveBoard
          settings={data.settings}
          onChange={(patch) =>
            setData((d) => (d ? { ...d, settings: { ...d.settings, ...patch } } : d))
          }
        />

        <div
          className={`grid gap-5 ${data.overdue.length > 0 ? '2xl:grid-cols-2' : ''}`}
        >
        {data.overdue.length > 0 && (
          <Panel title={t('Overdue')} count={data.overdue.length}>
            <ul>
              {data.overdue.map((t) => (
                <TaskRow key={t.id} task={t} overdue />
              ))}
            </ul>
          </Panel>
        )}

        <Panel title={t('Events of the day')} count={data.todayEvents.length}>
          {data.todayEvents.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">{t('No events today.')}</p>
          ) : (
            <ul>
              {data.todayEvents.map((o) => (
                <EventRow key={o.id} occurrence={o} />
              ))}
            </ul>
          )}
        </Panel>

        <Panel title={t('For today')} count={data.dueToday.length}>
          {data.dueToday.length === 0 ? (
            <p className="px-4 pb-4 text-sm text-muted">
              {nothingToday ? t('Nothing planned for today.') : t('Everything for today is done.')}
            </p>
          ) : (
            <ul>
              {data.dueToday.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </ul>
          )}
        </Panel>
        </div>

        {data.reminders.length > 0 && (
          <Panel title={t('Soon')} count={data.reminders.length}>
            <ul>
              {data.reminders.map((o) => (
                <li key={o.id} className="border-b border-line last:border-0">
                  <Link
                    to={`/calendar?date=${o.date}`}
                    className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-surface-2"
                  >
                    <span
                      className="size-2 shrink-0 rounded-full"
                      style={{ backgroundColor: o.calendar_color }}
                      aria-hidden
                    />
                    <span className="min-w-0 flex-1 truncate text-sm text-ink">{o.title}</span>
                    <span className="font-mono text-xs text-urgent">{formatDate(o.date)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Panel>
        )}

        <div className="grid gap-5 sm:grid-cols-2 2xl:grid-cols-3">
          <Panel title={t('Next 7 days')} count={data.upcoming.length}>
            {data.upcoming.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">{t('No deadlines in the next 7 days.')}</p>
            ) : (
              <ul>
                {data.upcoming.map((t) => (
                  <TaskRow key={t.id} task={t} overdue />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title={t('Recent notes')}>
            {data.recentNotes.length === 0 ? (
              <p className="px-4 pb-4 text-sm text-muted">{t('No notes yet.')}</p>
            ) : (
              <ul>
                {data.recentNotes.map((n) => (
                  <li key={n.id} className="border-b border-line last:border-0">
                    <Link
                      to={`/notes?open=${n.id}`}
                      className="block truncate px-4 py-3 text-sm text-ink transition-colors hover:bg-surface-2"
                    >
                      {n.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </Page>
  );
}
