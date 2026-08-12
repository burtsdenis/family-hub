import { t } from './i18n';

/** Календарь по умолчанию — единственный с заранее известным id (миграция 006). */
export const SHARED_CALENDAR_ID = '00000000-0000-4000-8000-000000000201';

/**
 * Имя календаря для показа. «Общий» — данные, а не интерфейс: он засеян
 * миграцией в базу по-русски, и словарь t() его не видит. Календарь один
 * и известен по фиксированному id — переводим на месте, как projectTitle
 * для «Входящих» в tasks.ts.
 */
export function calendarName(id: string, name: string): string {
  return id === SHARED_CALENDAR_ID && name === 'Общий' ? t('Общий') : name;
}

export interface Calendar {
  id: string;
  name: string;
  color: string;
  owner_id: string | null;
  shared: number;
  position: number;
  event_count: number;
}

export interface Participant {
  id: string;
  name: string;
  color: string;
}

/** Один экземпляр события: у повторяющейся серии их много. */
export interface Occurrence {
  id: string;
  event_id: string;
  date: string;
  starts_at: string;
  ends_at: string;
  title: string;
  description: string | null;
  location: string | null;
  all_day: number;
  is_recurring: boolean;
  calendar_id: string;
  calendar_name: string;
  calendar_color: string;
  project_id: string | null;
  project_title: string | null;
  remind_days_before: number | null;
  age: number | null;
  participants: Participant[];
}

export type CalendarView = 'week' | 'month' | 'agenda';

export const VIEW_LABEL: Record<CalendarView, string> = {
  week: t('Неделя'),
  month: t('Месяц'),
  agenda: t('Лента'),
};

export const REMIND_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: t('Не предупреждать') },
  { value: '1', label: t('За день') },
  { value: '3', label: t('За три дня') },
  { value: '7', label: t('За неделю') },
  { value: '14', label: t('За две недели') },
  { value: '30', label: t('За месяц') },
];

/**
 * Настройки вида хранятся на устройстве, а не в базе.
 * На стенде всегда неделя, на телефоне удобнее лента — и это разные
 * предпочтения одного и того же человека, а не одно общее.
 */
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`hub.calendar.${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(`hub.calendar.${key}`, JSON.stringify(value));
  } catch {
    // Приватный режим браузера может запрещать запись — не повод падать
  }
}
