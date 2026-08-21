import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LAYOUT,
  WIDGET_DEFS,
  boardUnits,
  normalizeLayout,
  packBoard,
  unitsFor,
  type PackItem,
} from './dashboard';

describe('normalizeLayout', () => {
  it('returns the default layout for garbage input', () => {
    expect(normalizeLayout(null)).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout('nonsense')).toEqual(DEFAULT_LAYOUT);
    expect(normalizeLayout([{ id: 'bogus', size: 4 }])).toEqual(DEFAULT_LAYOUT);
  });

  it('keeps stored order and appends widgets missing from the stored list', () => {
    const stored = [
      { id: 'notes', size: 4, col: 4, hidden: false },
      { id: 'agenda', size: 8, col: 0, hidden: true },
    ];
    const layout = normalizeLayout(stored);
    expect(layout.slice(0, 2)).toEqual([
      { id: 'notes', size: 4, col: 4, hidden: false },
      { id: 'agenda', size: 8, col: 0, hidden: true },
    ]);
    // Every known widget is present exactly once — a widget added in a
    // later release must appear even for a person with an old layout.
    expect(layout.map((s) => s.id).sort()).toEqual(Object.keys(WIDGET_DEFS).sort());
  });

  it('snaps a size the widget does not support to its default', () => {
    const layout = normalizeLayout([{ id: 'month', size: 8, col: 4, hidden: false }]);
    expect(layout[0]).toMatchObject({ id: 'month', size: 2 });
  });

  it('falls back to the default column for a missing or absurd one', () => {
    const layout = normalizeLayout([
      { id: 'month', size: 2, hidden: false }, // pre-column layout
      { id: 'money', size: 2, col: 99, hidden: false },
    ]);
    expect(layout[0]!.col).toBe(4);
    expect(layout[1]!.col).toBe(6);
  });

  it('collapses duplicates into the first occurrence', () => {
    const layout = normalizeLayout([
      { id: 'money', size: 4, col: 0, hidden: false },
      { id: 'money', size: 2, col: 2, hidden: true },
    ]);
    expect(layout.filter((s) => s.id === 'money')).toEqual([
      { id: 'money', size: 4, col: 0, hidden: false },
    ]);
  });
});

describe('packBoard', () => {
  // 8 units, width 1100, gap 20: colWidth = (1100 - 140) / 8 = 120.
  const pack = (items: PackItem[]) => packBoard(items, 8, 1100, 20, 32);

  it('anchors each widget to its column and stacks by list order', () => {
    const { boxes, height } = pack([
      { id: 'agenda', units: 4, col: 0, height: 700 },
      { id: 'month', units: 2, col: 4, height: 280 },
      { id: 'soon', units: 2, col: 6, height: 90 },
      { id: 'notes', units: 2, col: 6, height: 150 }, // under soon by choice
    ]);
    expect(boxes.get('agenda')).toMatchObject({ left: 0, top: 0 });
    expect(boxes.get('month')!.top).toBe(0);
    expect(boxes.get('soon')!.top).toBe(0);
    expect(boxes.get('notes')!.left).toBe(boxes.get('soon')!.left);
    expect(boxes.get('notes')!.top).toBe(90 + 20);
    expect(height).toBe(700);
  });

  it('gravity rests a widget on whatever its window already holds', () => {
    // A full-row widget bridges two columns of different depths and rests
    // on the deeper one.
    const { boxes } = pack([
      { id: 'money', units: 2, col: 0, height: 100 },
      { id: 'notes', units: 2, col: 4, height: 300 },
      { id: 'move', units: 8, col: 0, height: 160 },
    ]);
    expect(boxes.get('move')!.top).toBe(300 + 20);
  });

  it('snaps near-equal bottoms so the next band starts on one line', () => {
    const { boxes } = pack([
      { id: 'move', units: 4, col: 0, height: 215 },
      { id: 'money', units: 2, col: 4, height: 230 },
      { id: 'notes', units: 2, col: 6, height: 225 },
      { id: 'agenda', units: 4, col: 0, height: 500 },
      { id: 'month', units: 2, col: 4, height: 280 },
      { id: 'soon', units: 2, col: 6, height: 90 },
    ]);
    const band = 230 + 20;
    expect(boxes.get('agenda')!.top).toBe(band);
    expect(boxes.get('month')!.top).toBe(band);
    expect(boxes.get('soon')!.top).toBe(band);
  });

  it('clamps a column that no longer fits the board', () => {
    // Stored col 6 with a 4-unit widget on a 4-unit board → col 0.
    const { boxes } = packBoard(
      [{ id: 'move', units: 4, col: 6, height: 160 }],
      4,
      600,
      20,
      32,
    );
    expect(boxes.get('move')!.left).toBe(0);
  });

  it('board height is the deepest column without the trailing gap', () => {
    const { height } = pack([{ id: 'move', units: 8, col: 0, height: 160 }]);
    expect(height).toBe(160);
  });
});

describe('board sizing', () => {
  it('maps container width to unit count', () => {
    expect(boardUnits(1440)).toBe(8);
    expect(boardUnits(800)).toBe(4);
    expect(boardUnits(375)).toBe(1);
  });

  it('clamps widget sizes on narrow boards', () => {
    expect(unitsFor(8, 8)).toBe(8);
    expect(unitsFor(8, 4)).toBe(4);
    expect(unitsFor(2, 4)).toBe(2);
    expect(unitsFor(4, 1)).toBe(1);
  });
});
