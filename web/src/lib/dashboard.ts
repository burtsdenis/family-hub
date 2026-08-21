import { t } from './i18n';

/**
 * The dashboard is a board of widgets on an 8-unit grid: a size-2 widget
 * takes a quarter of the row, 4 a half, 8 the whole row. Order and sizes
 * are the person's own, per device — the kiosk in the hallway and the
 * phone in the pocket want different boards, so the layout lives in
 * localStorage, not in shared settings.
 */
export type WidgetId = 'move' | 'agenda' | 'month' | 'money' | 'soon' | 'notes';

export type WidgetSize = 2 | 4 | 8;

export interface WidgetSlot {
  id: WidgetId;
  size: WidgetSize;
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
  { id: 'move', size: 8, hidden: false },
  { id: 'agenda', size: 4, hidden: false },
  { id: 'month', size: 2, hidden: false },
  { id: 'money', size: 2, hidden: false },
  { id: 'soon', size: 2, hidden: false },
  { id: 'notes', size: 2, hidden: false },
];

export const LAYOUT_KEY = 'hub.dashboard.layout';

/**
 * Whatever localStorage holds becomes a valid layout: unknown widgets are
 * dropped, duplicates collapse into the first, a size outside the
 * widget's range snaps to its default, and widgets missing from the
 * stored list (added in a later release) are appended with defaults.
 */
export function normalizeLayout(raw: unknown): WidgetSlot[] {
  const out: WidgetSlot[] = [];
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue;
      const { id, size, hidden } = item as Partial<WidgetSlot>;
      if (!id || !(id in WIDGET_DEFS) || out.some((s) => s.id === id)) continue;
      const def = WIDGET_DEFS[id];
      const fallback = DEFAULT_LAYOUT.find((s) => s.id === id)!.size;
      out.push({
        id,
        size: def.sizes.includes(size as WidgetSize) ? (size as WidgetSize) : fallback,
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
  /** Measured content height, px. */
  height: number;
}

export interface PackedBox {
  left: number;
  top: number;
  width: number;
}

/**
 * The board's own packer. CSS dense placement was tried and lost: it is
 * greedy per item with no concept of a row, so column tops drifted apart
 * by whatever the content heights differed, and visible holes appeared
 * that no drag could fill.
 *
 * The rules are three, in user order:
 * - a widget goes into the shallowest column window that fits its width
 *   (leftmost wins a tie), so space fills instead of pooling;
 * - bottoms within `snap` px of a deeper neighbour are pulled down to it,
 *   so the next band starts on one shared line and tops read as a row;
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
    let bestCol = 0;
    let bestTop = Infinity;
    for (let col = 0; col + units <= totalUnits; col++) {
      const raw = Math.max(...depths.slice(col, col + units));
      // Snap to the deepest line within reach — widgets whose neighbours
      // above ended a few px lower still start on the same band line.
      let top = raw;
      for (const line of lines) if (line > top && line <= raw + snap) top = line;
      if (top < bestTop - 0.5) {
        bestTop = top;
        bestCol = col;
      }
    }
    boxes.set(item.id, {
      left: bestCol * (colWidth + gap),
      top: bestTop,
      width: units * colWidth + (units - 1) * gap,
    });
    const bottom = bestTop + item.height + gap;
    lines.push(bottom);
    for (let col = bestCol; col < bestCol + units; col++) depths[col] = bottom;
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
