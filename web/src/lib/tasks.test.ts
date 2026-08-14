import { describe, expect, it } from 'vitest';
import type { Task } from './api';
import { effectiveDate, isOverdue } from './tasks';

function task(partial: Partial<Task>): Task {
  return {
    id: 't1',
    project_id: 'p1',
    parent_id: null,
    level: 0,
    title: 'x',
    description: null,
    status: 'todo',
    priority: 'normal',
    due_date: null,
    expected_date: null,
    assignee_id: null,
    recurrence_rule: null,
    position: 1,
    ...partial,
  } as Task;
}

const TODAY = '2026-08-14';

describe('effectiveDate', () => {
  it('prefers the expected finish over the due date', () => {
    expect(effectiveDate(task({ due_date: '2026-08-10', expected_date: '2026-08-20' }))).toBe(
      '2026-08-20',
    );
    expect(effectiveDate(task({ due_date: '2026-08-10' }))).toBe('2026-08-10');
    expect(effectiveDate(task({}))).toBeNull();
  });
});

describe('isOverdue', () => {
  it('in-progress work with a future expected finish is not overdue (the coffee machine)', () => {
    expect(
      isOverdue(
        task({ status: 'in_progress', due_date: '2026-08-11', expected_date: '2026-08-18' }),
        TODAY,
      ),
    ).toBe(false);
  });

  it('a past expected finish makes the task overdue even with a future due date', () => {
    expect(isOverdue(task({ due_date: '2026-08-20', expected_date: '2026-08-12' }), TODAY)).toBe(
      true,
    );
  });

  it('falls back to the due date when no expected finish is set', () => {
    expect(isOverdue(task({ due_date: '2026-08-12' }), TODAY)).toBe(true);
    expect(isOverdue(task({ due_date: '2026-08-14' }), TODAY)).toBe(false);
  });

  it('closed tasks are never overdue', () => {
    expect(isOverdue(task({ status: 'done', due_date: '2026-08-01' }), TODAY)).toBe(false);
    expect(
      isOverdue(task({ status: 'cancelled', expected_date: '2026-08-01' }), TODAY),
    ).toBe(false);
  });
});
