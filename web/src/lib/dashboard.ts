import { t } from './i18n';

/**
 * The dashboard is a board of widgets on an 8-unit grid: a size-2 widget
 * takes a quarter of the row, 4 a half, 8 the whole row. Position, order
 * and sizes are the person's own, per device — the kiosk in the hallway
 * and the phone in the pocket want different boards, so the layout lives
 * in localStorage, not in shared settings.
 */
export type WidgetId = 'move' | 'agenda' | 'month' | 'money' | 'soon' | 'notes';

export type WidgetSize = 2 | 4 | 8;

export interface WidgetSlot {
  id: WidgetId;
  size: WidgetSize;
  /**
   * The left board unit the widget is anchored to (0–7). Vertical
   * position is not stored: gravity computes it from the list order,
   * so removing a widget never leaves a floating hole.
   */
  col: number;
  hidden: boolean;
}

export const WIDGET_DEFS: Record<WidgetId, { title: string; sizes: WidgetSize[] }> = {
  move: { title: t('The move'), sizes: [4, 8] },
  agenda: { title: t('Agenda'), sizes: [4, 8] },
  month: { title: t('Month'), sizes: [2, 4] },
  money: { title: t('Money'), sizes: [2, 4] },
  soon: { title: t('Soon'), sizes: [2, 4] },
  notes: { title: t('Recent notes'), sizes: [2, 4] },
};

export const DEFAULT_LAYOUT: WidgetSlot[] = [
  { id: 'move', size: 8, col: 0, hidden: false },
  { id: 'agenda', size: 4, col: 0, hidden: false },
  { id: 'month', size: 2, col: 4, hidden: false },
  { id: 'money', size: 2, col: 6, hidden: false },
  { id: 'soon', size: 2, col: 4, hidden: false },
  { id: 'notes', size: 2, col: 6, hidden: false },
];

export const LAYOUT_KEY = 'hub.dashboard.layout';

/**
 * Whatever localStorage holds becomes a valid layout: unknown widgets are
 * dropped, duplicates collapse into the first, a size outside the
 * widget's range snaps to its default, a missing or absurd column falls
 * back to the default's, and widgets missing from the stored list (added
 * in a later release) are appended with defaults.
 */
export function normalizeLayout(raw: unknown): WidgetSlot[] {
  const out: WidgetSlot[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const { id, size, col, hidden } = item as Partial<WidgetSlot>;
      if (!id || !(id in WIDGET_DEFS) || out.some((s) => s.id === id)) continue;
      const def = WIDGET_DEFS[id];
      const fallback = DEFAULT_LAYOUT.find((s) => s.id === id)!;
      out.push({
        id,
        size: def.sizes.includes(size as WidgetSize) ? (size as WidgetSize) : fallback.size,
        col:
          typeof col === 'number' && Number.isInteger(col) && col >= 0 && col < 8
            ? col
            : fallback.col,
        hidden: hidden === true,
      });
    }
  }
  for (const slot of DEFAULT_LAYOUT) {
    if (!out.some((s) => s.id === slot.id)) out.push({ ...slot });
  }
  return out;
}

// ── Packing ───────────────────────────────────────────────────────────────

export interface PackItem {
  id: WidgetId;
  /** Width in board units (already clamped to the board's unit count). */
  units: number;
  /** The left unit the widget is anchored to; clamped to the board here. */
  col: number;
  /** Measured content height, px. */
  height: number;
}

export interface PackedBox {
  left: number;
  top: number;
  width: number;
  /** The clamped column the box ended up at — drag math reads it back. */
  col: number;
  units: number;
}

/**
 * Gravity for explicitly placed widgets. Automatic packing (CSS dense,
 * then a skyline with heuristics) was tried and lost: any inference rule
 * eventually fights the person's intent. Now the column is the person's
 * choice, stored per widget; the packer only does what physics would:
 *
 * - each widget falls straight up its column window until it rests on
 *   whatever is already there (list order = stacking order);
 * - bottoms within `snap` px of a deeper neighbour count as one line, so
 *   the widgets resting on them start level and tops read as a row;
 * - the gap is part of the placement, not a CSS property.
 *
 * Pure math in, boxes out — testable without a browser.
 */
export function packBoard(
  items: PackItem[],
  totalUnits: number,
  width: number,
  gap = 20,
  snap = 32,
): { boxes: Map<WidgetId, PackedBox>; height: number } {
  const colWidth = (width - (totalUnits - 1) * gap) / totalUnits;
  const depths: number[] = new Array<number>(totalUnits).fill(0);
  // Every bottom ever produced is a band line — kept separately because a
  // line vanishes from `depths` as soon as a column grows past it, and
  // late widgets still want to align with it.
  const lines: number[] = [];
  const boxes = new Map<WidgetId, PackedBox>();

  for (const item of items) {
    const units = Math.max(1, Math.min(item.units, totalUnits));
    const col = Math.max(0, Math.min(item.col, totalUnits - units));

    const raw = Math.max(...depths.slice(col, col + units));
    // Snap to the deepest line within reach — widgets whose neighbours
    // above ended a few px lower still start on the same band line.
    let top = raw;
    for (const line of lines) if (line > top && line <= raw + snap) top = line;

    boxes.set(item.id, {
      left: col * (colWidth + gap),
      top,
      width: units * colWidth + (units - 1) * gap,
      col,
      units,
    });
    const bottom = top + item.height + gap;
    lines.push(bottom);
    for (let c = col; c < col + units; c++) depths[c] = bottom;
  }

  const deepest = Math.max(0, ...depths);
  return { boxes, height: deepest > 0 ? deepest - gap : 0 };
}

/** How many width units a widget takes on a board of the given unit count. */
export function unitsFor(size: WidgetSize, totalUnits: number): number {
  if (totalUnits >= 8) return size;
  if (totalUnits >= 4) return Math.min(size, 4);
  return 1;
}

/** Board width → unit count: the container is what matters, not the viewport. */
export function boardUnits(width: number): number {
  if (width >= 1088) return 8;
  if (width >= 640) return 4;
  return 1;
}
