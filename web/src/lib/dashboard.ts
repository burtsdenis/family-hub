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
