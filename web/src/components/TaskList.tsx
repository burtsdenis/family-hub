import { t } from '../lib/i18n';
import { useState } from 'react';
import { api, type Task, type TaskMutation } from '../lib/api';
import { formatDate } from '../lib/format';
import { PRIORITY_LABEL, isClosed, isOverdue, today, type TaskNode } from '../lib/tasks';
import { Empty } from './Page';

interface Props {
  nodes: TaskNode[];
  onChanged: (spawned?: Task | null) => void;
  onOpen: (task: Task) => void;
}

export function TaskList({ nodes, onChanged, onOpen }: Props) {
  if (nodes.length === 0) {
    return <Empty>{t('Задач нет. Добавьте первую — строка ввода прямо над списком.')}</Empty>;
  }
  return (
    <ul className="overflow-hidden rounded-card border border-line bg-surface">
      {nodes.map((node) => (
        <TaskItem key={node.id} node={node} depth={0} onChanged={onChanged} onOpen={onOpen} />
      ))}
    </ul>
  );
}

function TaskItem({
  node,
  depth,
  onChanged,
  onOpen,
}: {
  node: TaskNode;
  depth: number;
  onChanged: (spawned?: Task | null) => void;
  onOpen: (task: Task) => void;
}) {
  const [expanded, setExpanded] = useState(true);
  const [adding, setAdding] = useState(false);
  const [childTitle, setChildTitle] = useState('');
  const closed = isClosed(node);
  const overdue = isOverdue(node, today());
  const canNest = node.level < 2;

  async function toggle() {
    const res = await api.patch<TaskMutation>(`/tasks/${node.id}`, {
      status: closed ? 'todo' : 'done',
    });
    onChanged(res.spawned);
  }

  async function addChild() {
    const title = childTitle.trim();
    if (!title) return;
    const created = await api.post<Task>('/tasks', {
      project_id: node.project_id,
      parent_id: node.id,
      title,
    });
    setChildTitle('');
    setAdding(false);
    setExpanded(true);
    onChanged();
    onOpen(created);
  }

  return (
    <>
      <li
        className="group flex items-center gap-3 border-b border-line px-4 py-2.5 last:border-0"
        style={{ paddingLeft: `${1 + depth * 1.5}rem` }}
      >
        {node.children.length > 0 ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            aria-label={expanded ? t('Свернуть') : t('Развернуть')}
            className="-ml-5 w-4 text-muted transition-transform hover:text-ink"
            style={{ transform: expanded ? 'rotate(90deg)' : 'none' }}
          >
            ›
          </button>
        ) : (
          <span className="-ml-5 w-4" aria-hidden />
        )}

        <input
          type="checkbox"
          checked={closed}
          onChange={() => void toggle()}
          aria-label={closed ? t('Вернуть в работу') : t('Отметить выполненной')}
          className="size-4 shrink-0 accent-[var(--c-done)]"
        />

        <button
          type="button"
          onClick={() => onOpen(node)}
          className="min-w-0 flex-1 truncate text-left text-sm"
        >
          <span className={closed ? 'text-muted line-through' : 'text-ink'}>{node.title}</span>
          {node.child_count ? (
            <span className="ml-2 font-mono text-xs text-muted">
              {node.child_done}/{node.child_count}
            </span>
          ) : null}
        </button>

        {node.recurrence_rule && (
          <span className="font-mono text-xs text-muted" title={t('Повторяется')}>
            ↻
          </span>
        )}

        {node.priority !== 'normal' && !closed && (
          <span
            className={`hidden font-mono text-[0.625rem] tracking-wide uppercase sm:inline ${
              node.priority === 'urgent' || node.priority === 'high' ? 'text-urgent' : 'text-muted'
            }`}
          >
            {PRIORITY_LABEL[node.priority]}
          </span>
        )}

        {node.assignee_name && (
          <span
            className="hidden size-5 shrink-0 place-items-center rounded-full text-[0.625rem] font-medium text-white sm:grid"
            style={{ backgroundColor: node.assignee_color ?? 'var(--c-accent)' }}
            title={node.assignee_name}
          >
            {node.assignee_name.slice(0, 1)}
          </span>
        )}

        {node.due_date && (
          <span className={`font-mono text-xs ${overdue ? 'text-urgent' : 'text-muted'}`}>
            {formatDate(node.due_date)}
          </span>
        )}

        {canNest && (
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            title={node.level === 0 ? t('Добавить задачу') : t('Добавить подзадачу')}
            aria-label={node.level === 0 ? t('Добавить задачу') : t('Добавить подзадачу')}
            className="grid size-6 shrink-0 place-items-center rounded-md border border-line text-muted transition-colors hover:border-accent hover:text-accent"
          >
            +
          </button>
        )}
      </li>

      {adding && (
        <li className="border-b border-line px-4 py-2" style={{ paddingLeft: `${2.5 + depth * 1.5}rem` }}>
          <input
            autoFocus
            value={childTitle}
            placeholder={t('Название вложенной задачи')}
            onChange={(e) => setChildTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addChild();
              if (e.key === 'Escape') setAdding(false);
            }}
            onBlur={() => !childTitle && setAdding(false)}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink outline-none focus:border-accent"
          />
        </li>
      )}

      {expanded &&
        node.children.map((child) => (
          <TaskItem
            key={child.id}
            node={child}
            depth={depth + 1}
            onChanged={onChanged}
            onOpen={onOpen}
          />
        ))}
    </>
  );
}
