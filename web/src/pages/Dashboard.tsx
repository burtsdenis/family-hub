import { t } from '../lib/i18n';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, useSortable } from '@dnd-kit/sortable';
import { api, ApiError, type Dashboard as DashboardData, type Task } from '../lib/api';
import type { Occurrence } from '../lib/calendar';
import { loadLocal, saveLocal } from '../lib/storage';
import {
  DEFAULT_LAYOUT,
  LAYOUT_KEY,
  WIDGET_DEFS,
  boardUnits,
  normalizeLayout,
  packBoard,
  unitsFor,
  type PackedBox,
  type WidgetId,
  type WidgetSize,
  type WidgetSlot,
} from '../lib/dashboard';
import {
  WEEKDAYS_SHORT,
  addDays,
  dayNumber,
  endOfMonth,
  formatDate,
  monthTitle,
  startOfMonth,
  timeOf,
  weekdayIndex,
} from '../lib/format';
import { formatMoney, monthBounds, type Category, type Summary } from '../lib/money';
import { effectiveDate, today } from '../lib/tasks';
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
// showDate: whether a date renders at all; overdue: whether it's alarming.
function TaskRow({ task, showDate, overdue }: { task: Task; showDate?: boolean; overdue?: boolean }) {
  return (
    <li className="border-b border-line last:border-0">
      <Link
        to={`/tasks?open=${task.id}`}
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
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
        {showDate && effectiveDate(task) && (
          <span className={`font-mono text-xs ${overdue ? 'text-urgent' : 'text-muted'}`}>
            {formatDate(effectiveDate(task)!)}
          </span>
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
        className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
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

/** A group divider inside the agenda: «Сегодня · 21 августа», «Просрочено»… */
function GroupHeader({
  label,
  date,
  count,
  alarm,
}: {
  label: string;
  date?: string;
  count?: number;
  alarm?: boolean;
}) {
  return (
    <div className="flex items-baseline gap-2 border-b border-line bg-surface-2/40 px-4 py-2">
      <h3 className={`eyebrow ${alarm ? 'text-urgent' : ''}`}>{label}</h3>
      {date && <span className="font-mono text-xs text-muted">{formatDate(date)}</span>}
      {count !== undefined && count > 0 && (
        <span className="ml-auto font-mono text-xs text-muted tabular-nums">{count}</span>
      )}
    </div>
  );
}

/**
 * The whole week in one card instead of four look-alike lists: overdue,
 * then today (events and tasks together), then only the days that
 * actually hold something. An empty day is silence, not an empty panel.
 */
function Agenda({
  data,
  monthEvents,
  today: t0,
}: {
  data: DashboardData;
  monthEvents: Occurrence[];
  today: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(t0, i + 1)).map((date) => ({
    date,
    events: monthEvents.filter((o) => o.date === date),
    tasks: data.upcoming.filter((task) => effectiveDate(task) === date),
  }));
  const busyDays = days.filter((d) => d.events.length + d.tasks.length > 0);
  const nothingToday = data.dueToday.length === 0 && data.todayEvents.length === 0;

  return (
    <section className="self-start overflow-hidden rounded-card border border-line bg-surface">
      {data.overdue.length > 0 && (
        <>
          <GroupHeader label={t('Overdue')} count={data.overdue.length} alarm />
          <ul>
            {data.overdue.map((task) => (
              <TaskRow key={task.id} task={task} showDate overdue />
            ))}
          </ul>
        </>
      )}

      <GroupHeader
        label={t('Today')}
        date={t0}
        count={data.todayEvents.length + data.dueToday.length}
      />
      {nothingToday ? (
        <p className="border-b border-line px-4 py-3 text-sm text-muted last:border-0">
          {data.overdue.length > 0 ? t('Nothing planned for today.') : t('Everything for today is done.')}
        </p>
      ) : (
        <ul>
          {data.todayEvents.map((o) => (
            <EventRow key={o.id} occurrence={o} />
          ))}
          {data.dueToday.map((task) => (
            <TaskRow key={task.id} task={task} />
          ))}
        </ul>
      )}

      {busyDays.map((d, i) => (
        <div key={d.date}>
          <GroupHeader
            label={
              i === 0 && d.date === addDays(t0, 1)
                ? t('Tomorrow')
                : (WEEKDAYS_SHORT[weekdayIndex(d.date)] ?? '')
            }
            date={d.date}
          />
          <ul>
            {d.events.map((o) => (
              <EventRow key={o.id} occurrence={o} />
            ))}
            {d.tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        </div>
      ))}
      {busyDays.length === 0 && (
        <p className="px-4 py-3 text-sm text-muted">{t('The week ahead is clear.')}</p>
      )}
    </section>
  );
}

/** Month at a glance: dots are calendar colours, a day click opens that day. */
function MiniMonth({ today: t0, occurrences }: { today: string; occurrences: Occurrence[] }) {
  const first = startOfMonth(t0);
  const lead = weekdayIndex(first);
  const total = dayNumber(endOfMonth(t0));

  const dots = new Map<string, string[]>();
  for (const o of occurrences) {
    const list = dots.get(o.date) ?? [];
    if (list.length < 3 && !list.includes(o.calendar_color)) list.push(o.calendar_color);
    dots.set(o.date, list);
  }

  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3">
      <header className="flex items-baseline justify-between">
        <h2 className="eyebrow">{monthTitle(t0)}</h2>
        <Link to="/calendar" className="font-mono text-xs text-muted transition-colors hover:text-ink">
          {t('Calendar')} →
        </Link>
      </header>
      <div className="mt-2 grid grid-cols-7 text-center">
        {WEEKDAYS_SHORT.map((w) => (
          <span key={w} className="py-1 font-mono text-[0.625rem] text-muted uppercase">
            {w}
          </span>
        ))}
        {Array.from({ length: lead }, (_, i) => (
          <span key={`lead-${i}`} />
        ))}
        {Array.from({ length: total }, (_, i) => {
          const date = addDays(first, i);
          const isToday = date === t0;
          const dayDots = dots.get(date) ?? [];
          return (
            <Link
              key={date}
              to={`/calendar?date=${date}`}
              className="group flex flex-col items-center pb-1"
            >
              <span
                className={`grid size-6 place-items-center rounded-full text-xs tabular-nums transition-colors ${
                  isToday
                    ? 'bg-accent font-semibold text-white'
                    : date < t0
                      ? 'text-muted group-hover:bg-surface-2'
                      : 'text-ink group-hover:bg-surface-2'
                }`}
              >
                {i + 1}
              </span>
              <span className="flex h-1 gap-0.5">
                {dayDots.map((color, j) => (
                  <span key={j} className="size-1 rounded-full" style={{ backgroundColor: color }} />
                ))}
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Month money pulse: totals per currency and the three heaviest
 * categories. Subcategories roll up into their parent — same semantics
 * as the Money summary, without the expandable rows.
 */
function MoneyMonth({ summary, categories }: { summary: Summary; categories: Category[] }) {
  const expenses = summary.byCurrency.filter((r) => r.kind === 'expense');
  const income = summary.byCurrency.filter((r) => r.kind === 'income');

  const byId = new Map(categories.map((c) => [c.id, c]));
  const topByCurrency = new Map<
    string,
    Map<string, { name: string | null; color: string | null; total: number }>
  >();
  for (const r of summary.byCategory) {
    if (r.kind !== 'expense') continue;
    const bucket =
      topByCurrency.get(r.currency) ??
      new Map<string, { name: string | null; color: string | null; total: number }>();
    topByCurrency.set(r.currency, bucket);
    // A subcategory counts towards its parent only while the parent is
    // visible — same rule as the Money summary.
    const parent = r.parent_id ? byId.get(r.parent_id) : undefined;
    const key = parent?.id ?? r.category_id ?? 'none';
    const entry = bucket.get(key) ?? {
      name: parent?.name ?? r.category_name,
      color: parent?.color ?? r.color,
      total: 0,
    };
    entry.total += r.total;
    bucket.set(key, entry);
  }

  return (
    <section className="rounded-card border border-line bg-surface px-4 py-3">
      <header className="flex items-baseline justify-between">
        <h2 className="eyebrow">{t('Spending')}</h2>
        <Link to="/money" className="font-mono text-xs text-muted transition-colors hover:text-ink">
          {t('Money')} →
        </Link>
      </header>
      {expenses.length === 0 && income.length === 0 ? (
        <p className="mt-2 pb-1 text-sm text-muted">{t('No spending this month.')}</p>
      ) : (
        <div className="mt-2 space-y-4 pb-1">
          {expenses.map((r) => {
            const top = [...(topByCurrency.get(r.currency)?.values() ?? [])]
              .sort((a, b) => b.total - a.total)
              .slice(0, 3);
            const max = top[0]?.total ?? 1;
            const inc = income.find((i) => i.currency === r.currency);
            return (
              <div key={r.currency}>
                <p className="flex items-baseline gap-2">
                  <span className="font-display text-2xl font-bold tabular-nums">
                    {formatMoney(r.total, r.currency)}
                  </span>
                  {inc && (
                    <span className="font-mono text-xs text-done">
                      +{formatMoney(inc.total, inc.currency)}
                    </span>
                  )}
                </p>
                <ul className="mt-2 space-y-1.5">
                  {top.map((c) => (
                    <li key={c.name ?? 'none'} className="text-xs">
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="min-w-0 truncate text-muted">
                          {c.name ?? t('No category')}
                        </span>
                        <span className="font-mono text-muted tabular-nums">
                          {formatMoney(c.total, r.currency)}
                        </span>
                      </div>
                      <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3">
                        <div
                          className="h-full rounded-full"
                          style={{
                            width: `${Math.max(4, Math.round((c.total / max) * 100))}%`,
                            backgroundColor: c.color ?? 'var(--c-accent)',
                          }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {expenses.length === 0 &&
            income.map((r) => (
              <p key={r.currency} className="font-mono text-sm text-done">
                +{formatMoney(r.total, r.currency)}
              </p>
            ))}
        </div>
      )}
    </section>
  );
}

function SidePanel({
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
      <header className="flex items-baseline justify-between px-4 pt-3 pb-2">
        <h2 className="eyebrow">{title}</h2>
        {count !== undefined && count > 0 && (
          <span className="font-mono text-xs text-muted tabular-nums">{count}</span>
        )}
      </header>
      {children}
    </section>
  );
}

function SoonPanel({ items }: { items: Occurrence[] }) {
  return (
    <SidePanel title={t('Soon')} count={items.length}>
      <ul>
        {items.map((o) => (
          <li key={o.id} className="border-b border-line last:border-0">
            <Link
              to={`/calendar?date=${o.date}`}
              className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2"
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
    </SidePanel>
  );
}

function NotesPanel({ notes }: { notes: DashboardData['recentNotes'] }) {
  return (
    <SidePanel title={t('Recent notes')}>
      {notes.length === 0 ? (
        <p className="px-4 pb-3 text-sm text-muted">{t('No notes yet.')}</p>
      ) : (
        <ul>
          {notes.map((n) => (
            <li key={n.id} className="border-b border-line last:border-0">
              <Link
                to={`/notes?open=${n.id}`}
                className="block truncate px-4 py-2.5 text-sm text-ink transition-colors hover:bg-surface-2"
              >
                {n.title}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </SidePanel>
  );
}

/** The board's gap, px — lives in the packer's math, not in CSS. */
const BOARD_GAP = 20;

function SortableWidget({
  slot,
  editing,
  box,
  onHeight,
  onSize,
  onHide,
  children,
}: {
  slot: WidgetSlot;
  editing: boolean;
  box: PackedBox;
  onHeight: (id: WidgetId, height: number) => void;
  onSize: (size: WidgetSize) => void;
  onHide: () => void;
  children: React.ReactNode;
}) {
  // No sorting strategy transforms here: they assume equal-sized items
  // and stretch a 2-unit widget across an 8-unit slot mid-drag. The
  // reorder happens on drop; until then the hovered target shows a ring.
  const { attributes, listeners, setNodeRef, isDragging, isOver } = useSortable({
    id: slot.id,
    disabled: !editing,
  });
  const def = WIDGET_DEFS[slot.id];

  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => onHeight(slot.id, el.offsetHeight);
    measure();
    // Content height is alive: the agenda grows as the week fills,
    // the edit strip appears and disappears, the width changes on resize.
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [slot.id, onHeight]);

  return (
    <div
      ref={setNodeRef}
      style={{ position: 'absolute', left: box.left, top: box.top, width: box.width }}
      className={isDragging ? 'opacity-40' : ''}
    >
      <div
        ref={innerRef}
        className={`rounded-card ${editing && isOver && !isDragging ? 'ring-2 ring-accent' : ''}`}
      >
      {editing && (
        // The strip is the drag handle: the widget below is inert while
        // editing, so its links cannot swallow the gesture.
        <div
          className="mb-2 flex cursor-grab touch-none items-center gap-2 rounded-card border border-dashed border-line bg-surface-2 px-3 py-1.5 active:cursor-grabbing"
          {...attributes}
          {...listeners}
        >
          <svg
            viewBox="0 0 24 24"
            className="size-4 shrink-0 text-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M4 9h16M4 15h16" />
          </svg>
          <span className="eyebrow">{def.title}</span>
          <span className="ml-auto flex items-center gap-1">
            {def.sizes.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => onSize(s)}
                title={`${s}/8`}
                className={`rounded px-1.5 py-0.5 font-mono text-xs tabular-nums transition-colors ${
                  s === slot.size ? 'bg-accent text-white' : 'text-muted hover:bg-surface-3'
                }`}
              >
                {s}
              </button>
            ))}
            <button
              type="button"
              onClick={onHide}
              aria-label={t('Hide')}
              className="ml-1 rounded p-1 text-muted transition-colors hover:bg-surface-3 hover:text-ink"
            >
              <svg
                viewBox="0 0 24 24"
                className="size-4"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 3l18 18M10.6 5.1A9.8 9.8 0 0 1 12 5c7 0 10 7 10 7a17.4 17.4 0 0 1-3.2 4.2M6.6 6.6C3.8 8.4 2 12 2 12s3 7 10 7c1.4 0 2.7-.3 3.8-.8" />
              </svg>
            </button>
          </span>
        </div>
      )}
      <div className={editing ? 'pointer-events-none select-none' : ''}>{children}</div>
      </div>
    </div>
  );
}

export function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [monthEvents, setMonthEvents] = useState<Occurrence[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [layout, setLayout] = useState<WidgetSlot[]>(() =>
    normalizeLayout(loadLocal<unknown>(LAYOUT_KEY, null)),
  );
  const [editing, setEditing] = useState(false);
  const [dragging, setDragging] = useState<WidgetId | null>(null);

  // The packer needs the board's width and every widget's height; both
  // are observed, so the board re-packs itself on resize and as content
  // grows. A callback ref because the board mounts only after the data
  // arrives — a plain ref would leave the first mount unobserved.
  const [boardEl, setBoardEl] = useState<HTMLDivElement | null>(null);
  const [boardWidth, setBoardWidth] = useState(0);
  const [heights, setHeights] = useState<Partial<Record<WidgetId, number>>>({});
  useLayoutEffect(() => {
    if (!boardEl) return;
    const measure = () => setBoardWidth(boardEl.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(boardEl);
    return () => observer.disconnect();
  }, [boardEl]);
  const onHeight = useCallback((id: WidgetId, height: number) => {
    setHeights((prev) => (prev[id] === height ? prev : { ...prev, [id]: height }));
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  function updateLayout(next: WidgetSlot[]) {
    setLayout(next);
    saveLocal(LAYOUT_KEY, next);
  }

  function onDragStart(event: DragStartEvent) {
    setDragging(event.active.id as WidgetId);
  }

  // Reorder only on drop. A live reorder looked nicer but oscillated:
  // moving a widget changes the geometry, a different widget lands under
  // the pointer, the order flips back — an endless setState loop that
  // froze the page. The hovered target shows a ring instead (isOver).
  function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDragging(null);
    if (!over || active.id === over.id) return;
    const from = layout.findIndex((s) => s.id === active.id);
    const to = layout.findIndex((s) => s.id === over.id);
    if (from < 0 || to < 0) return;
    updateLayout(arrayMove(layout, from, to));
  }

  useEffect(() => {
    let alive = true;
    const load = () => {
      // The events range serves both the mini month and the week agenda —
      // near the month's end the agenda spills into the next month.
      const t0 = today();
      const weekEnd = addDays(t0, 7);
      const gridEnd = endOfMonth(t0);
      const bounds = monthBounds(t0);
      return Promise.all([
        api.get<DashboardData>('/dashboard'),
        api.get<Occurrence[]>(
          `/events?from=${startOfMonth(t0)}&to=${gridEnd > weekEnd ? gridEnd : weekEnd}`,
        ),
        api.get<Summary>(`/money/summary?from=${bounds.from}&to=${bounds.to}`),
        api.get<Category[]>('/categories'),
      ])
        .then(([d, events, sum, cats]) => {
          if (!alive) return;
          setData(d);
          setMonthEvents(events);
          setSummary(sum);
          setCategories(cats);
          setError(null);
        })
        .catch((e: Error) => {
          if (!alive) return;
          // A transient failure is what the interval exists for — a kiosk
          // that loses Wi-Fi for a minute must recover on its own. A 401
          // is not transient: the session is gone, retrying only hammers
          // the server (and re-runs the cache cleanup in api.ts) once a
          // minute for as long as the dead tab stays open. Stop; the auth
          // layer owns taking the person to the sign-in screen. (#58)
          if (e instanceof ApiError && e.status === 401) clearInterval(timer);
          setError(e.message);
        });
    };

    void load();
    // The kiosk stays open for days — refresh ourselves, no page reload.
    const timer = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  if (error && !data) {
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

  const soon = data.reminders.filter((o) => o.date > addDays(data.today, 7));

  // A widget with nothing to say renders nothing — unless the board is
  // being edited: then every widget must be visible to be arrangeable.
  const content: Record<WidgetId, React.ReactNode | null> = {
    move: (
      <MoveBoard
        settings={data.settings}
        onChange={(patch) =>
          setData((d) => (d ? { ...d, settings: { ...d.settings, ...patch } } : d))
        }
      />
    ),
    agenda: <Agenda data={data} monthEvents={monthEvents} today={data.today} />,
    month: <MiniMonth today={data.today} occurrences={monthEvents} />,
    money: summary ? <MoneyMonth summary={summary} categories={categories} /> : null,
    soon: soon.length > 0 ? <SoonPanel items={soon} /> : null,
    notes: <NotesPanel notes={data.recentNotes} />,
  };

  const visible = layout.filter(
    (s) => !s.hidden && (editing || content[s.id] !== null),
  );
  const hidden = layout.filter((s) => s.hidden);

  // Recomputed every render on purpose: six items of pure arithmetic is
  // cheaper than getting a memo's dependency list wrong.
  const packed = packBoard(
    visible.map((s) => ({
      id: s.id,
      units: unitsFor(s.size, boardUnits(boardWidth)),
      // Before the first measurement any positive height keeps the
      // packer sane; one layout-effect later the real one arrives.
      height: heights[s.id] ?? 160,
    })),
    boardUnits(boardWidth),
    boardWidth,
    BOARD_GAP,
  );

  return (
    <Page
      title={t('Today')}
      eyebrow={formatDate(data.today)}
      action={
        editing ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => updateLayout(DEFAULT_LAYOUT.map((s) => ({ ...s })))}
              className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
            >
              {t('Reset')}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
            >
              {t('Done')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="rounded-md border border-line px-3 py-1.5 text-sm text-muted transition-colors hover:text-ink"
          >
            {t('Customize')}
          </button>
        )
      }
    >
      <div className="space-y-5">
        <QuickActions />

        <DndContext
          sensors={sensors}
          // pointerWithin: the drop target is the widget under the pointer,
          // nothing else — closestCenter kept "helpfully" picking a far
          // neighbour when the pointer was over empty board.
          collisionDetection={pointerWithin}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDragging(null)}
        >
          <SortableContext items={visible.map((s) => s.id)} strategy={() => null}>
            <div ref={setBoardEl} className="relative" style={{ height: packed.height }}>
              {boardWidth > 0 &&
                visible.map((slot) => {
                  const box = packed.boxes.get(slot.id);
                  if (!box) return null;
                  return (
                    <SortableWidget
                      key={slot.id}
                      slot={slot}
                      editing={editing}
                      box={box}
                      onHeight={onHeight}
                      onSize={(size) =>
                        updateLayout(layout.map((s) => (s.id === slot.id ? { ...s, size } : s)))
                      }
                      onHide={() =>
                        updateLayout(
                          layout.map((s) => (s.id === slot.id ? { ...s, hidden: true } : s)),
                        )
                      }
                    >
                      {content[slot.id] ?? (
                        <div className="rounded-card border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                          {t('Nothing here yet.')}
                        </div>
                      )}
                    </SortableWidget>
                  );
                })}
            </div>
          </SortableContext>
          <DragOverlay>
            {dragging && (
              <div className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-1.5 shadow-md">
                <svg
                  viewBox="0 0 24 24"
                  className="size-4 shrink-0 text-muted"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                >
                  <path d="M4 9h16M4 15h16" />
                </svg>
                <span className="eyebrow">{WIDGET_DEFS[dragging].title}</span>
              </div>
            )}
          </DragOverlay>
        </DndContext>

        {editing && hidden.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="eyebrow">{t('Hidden')}</span>
            {hidden.map((slot) => (
              <button
                key={slot.id}
                type="button"
                onClick={() =>
                  updateLayout(layout.map((s) => (s.id === slot.id ? { ...s, hidden: false } : s)))
                }
                className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-muted transition-colors hover:text-ink"
              >
                + {WIDGET_DEFS[slot.id].title}
              </button>
            ))}
          </div>
        )}
      </div>
    </Page>
  );
}
