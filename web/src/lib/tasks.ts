import { t } from './i18n';
import type { Task } from './api';

export const STATUSES = ['backlog', 'todo', 'in_progress', 'done', 'cancelled'] as const;
export type Status = (typeof STATUSES)[number];

export const STATUS_LABEL: Record<Status, string> = {
  backlog: t('Когда-нибудь'),
  todo: t('К работе'),
  in_progress: t('В работе'),
  done: t('Готово'),
  cancelled: t('Отменено'),
};

/** Колонки доски. «Отменено» на доске не показываем — это не этап, а исход. */
export const BOARD_COLUMNS: Status[] = ['backlog', 'todo', 'in_progress', 'done'];

export const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: t('Низкий'),
  normal: t('Обычный'),
  high: t('Высокий'),
  urgent: t('Срочно'),
};

export const LEVEL_LABEL = [t('Стори'), t('Задача'), t('Подзадача')] as const;

export const RECURRENCE_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: t('Не повторяется') },
  { value: 'FREQ=DAILY', label: t('Каждый день') },
  { value: 'FREQ=WEEKLY', label: t('Каждую неделю') },
  { value: 'FREQ=WEEKLY;INTERVAL=2', label: t('Раз в две недели') },
  { value: 'FREQ=MONTHLY', label: t('Каждый месяц') },
  { value: 'FREQ=MONTHLY;INTERVAL=3', label: t('Раз в квартал') },
  { value: 'FREQ=YEARLY', label: t('Каждый год') },
];

/** Проект по умолчанию — единственный, чей id известен заранее (миграция 004). */
export const INBOX_ID = '00000000-0000-4000-8000-000000000001';

/**
 * Название проекта для показа. «Входящие» — данные, а не интерфейс:
 * они засеяны миграцией в базу по-русски, и словарь t() их не видит.
 * Проект один и известен по фиксированному id — переводим на месте.
 */
export function projectTitle(id: string | null | undefined, title: string): string {
  return id === INBOX_ID ? t('Входящие') : title;
}

export interface TaskNode extends Task {
  children: TaskNode[];
}

/**
 * Плоский список превращаем в дерево, сохраняя порядок из ответа сервера.
 * Задачи, чей родитель отфильтрован, поднимаются на верхний уровень —
 * иначе они бы просто исчезли из выдачи, и человек решил бы, что их нет.
 */
export function buildTree(tasks: Task[]): TaskNode[] {
  const nodes = new Map<string, TaskNode>();
  for (const task of tasks) nodes.set(task.id, { ...task, children: [] });

  const roots: TaskNode[] = [];
  for (const task of tasks) {
    const node = nodes.get(task.id)!;
    const parent = task.parent_id ? nodes.get(task.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

export function isOverdue(task: Task, today: string): boolean {
  return Boolean(task.due_date && task.due_date < today && !isClosed(task));
}

export function isClosed(task: Task): boolean {
  return task.status === 'done' || task.status === 'cancelled';
}

export function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}
