import { t } from '../lib/i18n';
import { projectTitle } from '../lib/tasks';
import { useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { api, type Task } from '../lib/api';
import { formatDate } from '../lib/format';
import { BOARD_COLUMNS, PRIORITY_LABEL, STATUS_LABEL, isOverdue, today, type Status } from '../lib/tasks';

interface Props {
  tasks: Task[];
  onChanged: () => void;
  onOpen: (task: Task) => void;
}

export function TaskBoard({ tasks, onChanged, onOpen }: Props) {
  const [dragging, setDragging] = useState<Task | null>(null);
  // После броска карточки браузер всё равно отдаёт click по ней —
  // без этого флага перетаскивание заканчивалось бы открытием задачи
  const justDragged = useRef(false);
  // Локальная копия, чтобы карточка вставала на место сразу, не дожидаясь сервера
  const [optimistic, setOptimistic] = useState<Task[] | null>(null);
  const current = optimistic ?? tasks;

  const columns = useMemo(() => {
    const map = new Map<Status, Task[]>(BOARD_COLUMNS.map((s) => [s, []]));
    for (const task of current) {
      const bucket = map.get(task.status as Status);
      if (bucket) bucket.push(task);
    }
    return map;
  }, [current]);

  // Планшет: задержка не даёт спутать перетаскивание с прокруткой
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
  );

  function onDragStart(event: DragStartEvent) {
    justDragged.current = true;
    setDragging(current.find((t) => t.id === event.active.id) ?? null);
  }

  // click приходит синхронно после pointerup, то есть до этого таймера —
  // флаг доживает ровно до конца текущего цикла событий
  function dropDragFlag() {
    setTimeout(() => {
      justDragged.current = false;
    }, 0);
  }

  async function onDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setDragging(null);
    dropDragFlag();
    if (!over) return;

    const task = current.find((t) => t.id === active.id);
    if (!task) return;

    // Бросок на колонку даёт её идентификатор, бросок на карточку — соседа
    const overTask = current.find((t) => t.id === over.id);
    const target = (overTask?.status ?? over.id) as Status;
    if (!BOARD_COLUMNS.includes(target)) return;

    const columnTasks = (columns.get(target) ?? []).filter((t) => t.id !== task.id);
    const insertAt = overTask ? columnTasks.findIndex((t) => t.id === overTask.id) : columnTasks.length;
    const ordered = [...columnTasks];
    ordered.splice(insertAt < 0 ? ordered.length : insertAt, 0, { ...task, status: target });

    setOptimistic(
      current.map((t) => (t.id === task.id ? { ...t, status: target } : t)),
    );

    try {
      if (task.status !== target) {
        await api.patch(`/tasks/${task.id}`, { status: target });
      }
      await api.post('/tasks/reorder', { ids: ordered.map((t) => t.id) });
    } finally {
      setOptimistic(null);
      onChanged();
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => {
        setDragging(null);
        dropDragFlag();
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4 3xl:gap-6">
        {BOARD_COLUMNS.map((status) => (
          <Column
            key={status}
            status={status}
            tasks={columns.get(status) ?? []}
            onOpen={(task) => {
              if (!justDragged.current) onOpen(task);
            }}
          />
        ))}
      </div>

      <DragOverlay>{dragging ? <Card task={dragging} overlay /> : null}</DragOverlay>
    </DndContext>
  );
}

function Column({
  status,
  tasks,
  onOpen,
}: {
  status: Status;
  tasks: Task[];
  onOpen: (task: Task) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });

  return (
    <section
      ref={setNodeRef}
      className={`rounded-card border bg-surface-2 p-3 transition-colors ${
        isOver ? 'border-accent' : 'border-line'
      }`}
    >
      <header className="mb-3 flex items-baseline justify-between px-1">
        <h3 className="eyebrow">{STATUS_LABEL[status]}</h3>
        <span className="font-mono text-xs text-muted tabular-nums">{tasks.length}</span>
      </header>

      <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
        <div className="min-h-16 space-y-2">
          {tasks.map((task) => (
            <SortableCard key={task.id} task={task} onOpen={onOpen} />
          ))}
          {tasks.length === 0 && (
            <p className="px-1 py-3 text-xs text-muted">{t('Перетащите задачу сюда')}</p>
          )}
        </div>
      </SortableContext>
    </section>
  );
}

function SortableCard({ task, onOpen }: { task: Task; onOpen: (task: Task) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: task.id,
  });

  // Клик открывает карточку, перетаскивание — перетаскивает: сенсор
  // с порогом в 6px начинает drag только после заметного движения,
  // поэтому обычный клик до него не дотягивает и остаётся кликом
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`cursor-pointer ${isDragging ? 'opacity-40' : ''}`}
      onClick={() => onOpen(task)}
      {...attributes}
      {...listeners}
    >
      <Card task={task} />
    </div>
  );
}

function Card({ task, overlay }: { task: Task; overlay?: boolean }) {
  const overdue = isOverdue(task, today());

  return (
    <article
      className={`rounded-lg border border-line bg-surface px-3 py-2.5 ${
        overlay ? 'shadow-lg' : ''
      }`}
    >
      <p className="text-sm text-ink">
        {task.level > 0 && (
          <span className="mr-1 text-muted" title={t('Вложенная задача')}>
            ↳
          </span>
        )}
        {task.title}
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {task.project_title && (
          <span className="flex items-center gap-1.5 text-xs text-muted">
            <span
              className="size-1.5 rounded-full"
              style={{ backgroundColor: task.project_color ?? 'var(--c-accent)' }}
              aria-hidden
            />
            {projectTitle(task.project_id, task.project_title)}
          </span>
        )}
        {task.priority !== 'normal' && (
          <span
            className={`font-mono text-[0.625rem] tracking-wide uppercase ${
              task.priority === 'urgent' || task.priority === 'high' ? 'text-urgent' : 'text-muted'
            }`}
          >
            {PRIORITY_LABEL[task.priority]}
          </span>
        )}
        {task.due_date && (
          <span className={`font-mono text-xs ${overdue ? 'text-urgent' : 'text-muted'}`}>
            {formatDate(task.due_date)}
          </span>
        )}
        {task.assignee_name && (
          <span
            className="ml-auto grid size-5 place-items-center rounded-full text-[0.625rem] font-medium text-white"
            style={{ backgroundColor: task.assignee_color ?? 'var(--c-accent)' }}
            title={task.assignee_name}
          >
            {task.assignee_name.slice(0, 1)}
          </span>
        )}
      </div>
    </article>
  );
}
