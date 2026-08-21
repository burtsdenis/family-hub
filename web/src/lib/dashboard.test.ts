import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, WIDGET_DEFS, normalizeLayout } from './dashboard';

describe('normalizeLayout', () => {
  it('returns the default layout for garbage input', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nonsense')).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout([{ id: 'bogus', size: 4 }])).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps stored order and appends widgets missing from the stored list', () => {
    const stored = [
      { id: 'notes', size: 4, hidden: false },
      { id: 'agenda', size: 8, hidden: true },
    ];
    const layout = normalizeLayout(stored);
    expect(layout.slice(0, 2)).toEqual([
      { id: 'notes', size: 4, hidden: false },
      { id: 'agenda', size: 8, hidden: true },
    ]);
    // Every known widget is present exactly once — a widget added in a
    // later release must appear even for a person with an old layout.
    expect(layout.map((s) => s.id).sort()).toEqual(Object.keys(WIDGET_DEFS).sort());
  });

  it('snaps a size the widget does not support to its default', () => {
    const layout = normalizeLayout([{ id: 'month', size: 8, hidden: false }]);
    expect(layout[0]).toEqual({ id: 'month', size: 2, hidden: false });
  });

  it('collapses duplicates into the first occurrence', () => {
    const layout = normalizeLayout([
      { id: 'money', size: 4, hidden: false },
      { id: 'money', size: 2, hidden: true },
    ]);
    expect(layout.filter((s) => s.id === 'money')).toEqual([
      { id: 'money', size: 4, hidden: false },
    ]);
  });
});
