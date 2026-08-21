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

describe('packBoard', () => {
  // 8 units, width 1100, gap 20: colWidth = (1100 - 140) / 8 = 120.
  const pack = (items: PackItem[]) => packBoard(items, 8, 1100, 20, 32);

  it('fills a band left to right and starts the next one below', () => {
    const { boxes } = pack([
      { id: 'move', units: 4, height: 160 },
      { id: 'money', units: 2, height: 160 },
      { id: 'notes', units: 2, height: 160 },
      { id: 'agenda', units: 4, height: 500 },
    ]);
    expect(boxes.get('move')).toMatchObject({ left: 0, top: 0 });
    expect(boxes.get('money')!.left).toBeGreaterThan(0);
    expect(boxes.get('money')!.top).toBe(0);
    expect(boxes.get('notes')!.top).toBe(0);
    expect(boxes.get('agenda')).toMatchObject({ left: 0, top: 180 });
  });

  it('snaps near-equal bottoms so the next band starts on one line', () => {
    // Heights differ by less than the snap window — the band below must
    // start at the deepest of the three bottoms.
    const { boxes } = pack([
      { id: 'move', units: 4, height: 215 },
      { id: 'money', units: 2, height: 230 },
      { id: 'notes', units: 2, height: 225 },
      { id: 'agenda', units: 4, height: 500 },
      { id: 'month', units: 2, height: 280 },
    ]);
    const band = 230 + 20;
    expect(boxes.get('agenda')!.top).toBe(band);
    expect(boxes.get('month')!.top).toBe(band);
  });

  it('stacks a widget under the previous one while the anchor column is taller', () => {
    // The order is the column: month right of the tall agenda, soon
    // directly under the month — even though the column further right
    // (under notes) is emptier. This is what dragging "under the month"
    // means; a shallowest-first rule would steal the widget to the right.
    const { boxes } = pack([
      { id: 'move', units: 4, height: 215 },
      { id: 'money', units: 2, height: 230 },
      { id: 'notes', units: 2, height: 225 },
      { id: 'agenda', units: 4, height: 500 },
      { id: 'month', units: 2, height: 280 },
      { id: 'soon', units: 2, height: 90 },
    ]);
    expect(boxes.get('soon')!.left).toBe(boxes.get('month')!.left);
    expect(boxes.get('soon')!.top).toBe(250 + 280 + 20);
  });

  it('keeps stacking one column until it catches the tall anchor, then opens a new one', () => {
    const { boxes, height } = pack([
      { id: 'agenda', units: 4, height: 700 },
      { id: 'month', units: 2, height: 280 },
      { id: 'soon', units: 2, height: 90 },
      { id: 'money', units: 2, height: 180 },
      { id: 'notes', units: 2, height: 300 },
    ]);
    // month opens the column beside the agenda; soon and money follow it
    expect(boxes.get('month')!.top).toBe(0);
    expect(boxes.get('soon')!.top).toBe(300);
    expect(boxes.get('money')!.top).toBe(410);
    expect(boxes.get('soon')!.left).toBe(boxes.get('month')!.left);
    expect(boxes.get('money')!.left).toBe(boxes.get('month')!.left);
    // the column has now reached 610+? no: money bottom 410+180+20=610 <
    // 720, notes would make it 930 — still stacks (the check is the top,
    // not the bottom), and the board grows with it
    expect(boxes.get('notes')!.left).toBe(boxes.get('month')!.left);
    expect(height).toBe(610 + 300);
  });

  it('a widget wider than what remains goes below the shallowest columns', () => {
    // Only 2 units are free in the top band — the 4-unit widget cannot
    // take them and lands under the month, not under the tall agenda.
    // (The 2-unit hole above its right half is the skyline's known blind
    // spot: reordering fills it, the packer alone does not.)
    const { boxes } = pack([
      { id: 'agenda', units: 4, height: 400 },
      { id: 'month', units: 2, height: 200 },
      { id: 'move', units: 4, height: 160 },
    ]);
    expect(boxes.get('move')!.top).toBe(220);
    expect(boxes.get('move')!.left).toBe(boxes.get('month')!.left);
  });

  it('board height is the deepest column without the trailing gap', () => {
    const { height } = pack([{ id: 'move', units: 8, height: 160 }]);
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
