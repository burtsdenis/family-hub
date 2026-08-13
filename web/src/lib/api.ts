import { t } from './i18n';
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new ApiError(t(body?.error ?? 'Сервер недоступен'), res.status);
  }
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(body) }),
  patch: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(body) }),
  put: <T>(path: string, body: unknown) =>
    request<T>(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// ── Types shared with the server ──────────────────────────────────────────

export type TaskStatus = 'backlog' | 'todo' | 'in_progress' | 'done' | 'cancelled';
export type TaskPriority = 'low' | 'normal' | 'high' | 'urgent';

export interface Task {
  id: string;
  project_id: string;
  parent_id: string | null;
  level: 0 | 1 | 2;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  recurrence_rule: string | null;
  position: number;
  project_title?: string;
  project_color?: string;
  assignee_name?: string | null;
  assignee_color?: string | null;
  child_count?: number;
  child_done?: number;
}

export interface Project {
  id: string;
  title: string;
  description: string | null;
  color: string;
  icon: string | null;
  position: number;
  archived_at: string | null;
  open_tasks: number;
  total_tasks: number;
}

export interface HouseholdMember {
  id: string;
  name: string;
  color: string;
}

/** Response to a task mutation: the task itself plus the spawned recurrence, if any. */
export interface TaskMutation {
  task: Task;
  spawned: Task | null;
}

export interface NoteStub {
  id: string;
  title: string;
  updated_at: string;
}

export interface Dashboard {
  today: string;
  dueToday: Task[];
  overdue: Task[];
  upcoming: Task[];
  recentNotes: NoteStub[];
  todayEvents: import('./calendar').Occurrence[];
  reminders: import('./calendar').Occurrence[];
  settings: Record<string, string>;
}
