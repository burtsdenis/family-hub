import { t } from '../lib/i18n';
import { useEffect, useState } from 'react';
import { api, type HouseholdMember, type Project } from '../lib/api';
import { REMIND_OPTIONS, calendarName, type Calendar, type Occurrence } from '../lib/calendar';
import { RECURRENCE_OPTIONS } from '../lib/tasks';
import { dialogKeys, onEnter } from '../lib/keys';
import { timeOf } from '../lib/format';
import { useDialogs } from './Dialog';

const field =
  'w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none focus:border-accent';
const label = 'mb-1.5 block text-sm font-medium text-ink';

interface Props {
  /** Существующий экземпляр либо дата для нового события. */
  occurrence: Occurrence | null;
  defaultDate: string;
  calendars: Calendar[];
  members: HouseholdMember[];
  projects: Project[];
  onSaved: () => void;
  onClose: () => void;
}

export function EventDialog({
  occurrence,
  defaultDate,
  calendars,
  members,
  projects,
  onSaved,
  onClose,
}: Props) {
  const editing = occurrence !== null;
  const dialogs = useDialogs();

  const [draft, setDraft] = useState(() => ({
    calendar_id: occurrence?.calendar_id ?? calendars[0]?.id ?? '',
    title: occurrence?.title ?? '',
    description: occurrence?.description ?? '',
    location: occurrence?.location ?? '',
    all_day: occurrence ? occurrence.all_day === 1 : true,
    start_date: occurrence?.date ?? defaultDate,
    end_date: occurrence?.ends_at.slice(0, 10) ?? defaultDate,
    start_time: occurrence ? timeOf(occurrence.starts_at) || '10:00' : '10:00',
    end_time: occurrence ? timeOf(occurrence.ends_at) || '11:00' : '11:00',
    // Подтягивается ниже: в экземпляре серии правила повтора нет
    recurrence_rule: '',
    project_id: occurrence?.project_id ?? '',
    remind_days_before:
      occurrence?.remind_days_before !== null && occurrence?.remind_days_before !== undefined
        ? String(occurrence.remind_days_before)
        : '',
    birth_year: '',
    participants: occurrence?.participants.map((p) => p.id) ?? [],
  }));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Правило повтора и год рождения приходят только с полным событием
  useEffect(() => {
    if (!occurrence) return;
    void api
      .get<{ recurrence_rule: string | null; birth_year: number | null }>(
        `/events/${occurrence.event_id}`,
      )
      .then((full) =>
        setDraft((d) => ({
          ...d,
          recurrence_rule: full.recurrence_rule ?? '',
          birth_year: full.birth_year ? String(full.birth_year) : '',
        })),
      )
      .catch(() => {});
  }, [occurrence]);

  // Без списка зависимостей: подписка обновляется на каждый рендер,
  // и save всегда видит актуальный черновик
  useEffect(() => {
    const onKey = dialogKeys(() => {
      if (!busy) void save();
    }, onClose);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function payload() {
    return {
      calendar_id: draft.calendar_id,
      title: draft.title,
      description: draft.description || null,
      location: draft.location || null,
      all_day: draft.all_day,
      starts_at: draft.all_day ? draft.start_date : `${draft.start_date}T${draft.start_time}`,
      ends_at: draft.all_day ? draft.end_date : `${draft.end_date}T${draft.end_time}`,
      recurrence_rule: draft.recurrence_rule || null,
      project_id: draft.project_id || null,
      remind_days_before: draft.remind_days_before ? Number(draft.remind_days_before) : null,
      birth_year: draft.birth_year ? Number(draft.birth_year) : null,
      participants: draft.participants,
    };
  }

  async function save() {
    if (!draft.title.trim()) {
      setError(t('Укажите название события'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (editing) await api.patch(`/events/${occurrence.event_id}`, payload());
      else await api.post('/events', payload());
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('Не удалось сохранить'));
    } finally {
      setBusy(false);
    }
  }

  /** У повторяющегося события удаление — это два разных действия. */
  async function removeOne() {
    if (!occurrence) return;
    await api.delete(`/events/${occurrence.event_id}/occurrences/${occurrence.date}`);
    onSaved();
    onClose();
  }

  async function removeAll() {
    if (!occurrence) return;
    const ok = await dialogs.confirm({
      title: occurrence.is_recurring ? t('Удалить серию') : t('Удалить событие'),
      message: occurrence.is_recurring
        ? t('«{title}» исчезнет из всех дат, включая прошедшие.', { title: occurrence.title })
        : t('«{title}» будет удалено.', { title: occurrence.title }),
      confirmLabel: t('Удалить'),
      danger: true,
    });
    if (!ok) return;
    await api.delete(`/events/${occurrence.event_id}`);
    onSaved();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto px-5 py-12">
      <button
        type="button"
        aria-label={t('Закрыть')}
        onClick={onClose}
        className="fixed inset-0 bg-black/40"
      />

      <div className="relative w-full max-w-lg rounded-card border border-line bg-surface p-5 shadow-xl">
        <h2 className="eyebrow mb-4">{editing ? t('Событие') : t('Новое событие')}</h2>

        <div className="space-y-4">
          <label className="block">
            <span className={label}>{t('Название')}</span>
            <input
              autoFocus
              value={draft.title}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
              onKeyDown={onEnter(() => void save())}
              className={field}
            />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>{t('Календарь')}</span>
              <select
                value={draft.calendar_id}
                onChange={(e) => setDraft({ ...draft, calendar_id: e.target.value })}
                className={field}
              >
                {calendars.map((c) => (
                  <option key={c.id} value={c.id}>
                    {calendarName(c.id, c.name)}
                    {c.shared ? '' : t(' (личный)')}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={label}>{t('Место')}</span>
              <input
                value={draft.location}
                onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                className={field}
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={draft.all_day}
              onChange={(e) => setDraft({ ...draft, all_day: e.target.checked })}
              className="size-4 accent-[var(--c-accent)]"
            />
            {t('Весь день')}
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>{t('Начало')}</span>
              <input
                type="date"
                value={draft.start_date}
                onChange={(e) =>
                  setDraft({
                    ...draft,
                    start_date: e.target.value,
                    end_date:
                      draft.end_date < e.target.value ? e.target.value : draft.end_date,
                  })
                }
                className={field}
              />
            </label>

            <label className="block">
              <span className={label}>{t('Конец')}</span>
              <input
                type="date"
                value={draft.end_date}
                onChange={(e) => setDraft({ ...draft, end_date: e.target.value })}
                className={field}
              />
            </label>

            {!draft.all_day && (
              <>
                <label className="block">
                  <span className={label}>{t('Время начала')}</span>
                  <input
                    type="time"
                    value={draft.start_time}
                    onChange={(e) => setDraft({ ...draft, start_time: e.target.value })}
                    className={field}
                  />
                </label>
                <label className="block">
                  <span className={label}>{t('Время конца')}</span>
                  <input
                    type="time"
                    value={draft.end_time}
                    onChange={(e) => setDraft({ ...draft, end_time: e.target.value })}
                    className={field}
                  />
                </label>
              </>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className={label}>{t('Повторение')}</span>
              <select
                value={draft.recurrence_rule}
                onChange={(e) => setDraft({ ...draft, recurrence_rule: e.target.value })}
                className={field}
              >
                {RECURRENCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className={label}>{t('Предупредить')}</span>
              <select
                value={draft.remind_days_before}
                onChange={(e) => setDraft({ ...draft, remind_days_before: e.target.value })}
                className={field}
              >
                {REMIND_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {draft.recurrence_rule === 'FREQ=YEARLY' && (
            <label className="block">
              <span className={label}>{t('Год рождения')}</span>
              <input
                type="number"
                placeholder={t('Необязательно — покажет возраст')}
                value={draft.birth_year}
                onChange={(e) => setDraft({ ...draft, birth_year: e.target.value })}
                className={field}
              />
            </label>
          )}

          <label className="block">
            <span className={label}>{t('Проект')}</span>
            <select
              value={draft.project_id}
              onChange={(e) => setDraft({ ...draft, project_id: e.target.value })}
              className={field}
            >
              <option value="">{t('Без проекта')}</option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title}
                </option>
              ))}
            </select>
          </label>

          <div>
            <span className={label}>{t('Кто идёт')}</span>
            {members.length < 2 && (
              <p className="mb-2 text-xs text-muted">
                {t('Выбирать пока не из кого: в доме одна учётная запись. Заведите личные учётки в разделе «Пользователи» — тогда здесь появятся все домочадцы.')}
              </p>
            )}
              <div className="flex flex-wrap gap-2">
                {members.map((m) => {
                  const on = draft.participants.includes(m.id);
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setDraft({
                          ...draft,
                          participants: on
                            ? draft.participants.filter((p) => p !== m.id)
                            : [...draft.participants, m.id],
                        })
                      }
                      className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                        on ? 'border-accent bg-accent-soft text-accent' : 'border-line text-muted'
                      }`}
                    >
                      {m.name}
                    </button>
                  );
                })}
            </div>
          </div>

          <label className="block">
            <span className={label}>{t('Описание')}</span>
            <textarea
              rows={3}
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              className={`${field} resize-y`}
            />
          </label>

          {error && <p className="text-sm text-urgent">{error}</p>}
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {editing && occurrence.is_recurring && (
            <button
              type="button"
              onClick={() => void removeOne()}
              className="text-sm text-muted underline underline-offset-2 hover:text-ink"
            >
              {t('Отменить этот раз')}
            </button>
          )}
          {editing && (
            <button
              type="button"
              onClick={() => void removeAll()}
              className="text-sm text-muted underline underline-offset-2 hover:text-urgent"
            >
              {occurrence.is_recurring ? t('Удалить серию') : t('Удалить')}
            </button>
          )}

          <button
            type="button"
            onClick={() => void save()}
            disabled={busy}
            className="ml-auto rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? t('Сохраняю') : t('Сохранить')}
          </button>
        </div>
      </div>
    </div>
  );
}
