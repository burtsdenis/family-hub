import { api } from './api';

/**
 * Colors for entities (projects, calendars, accounts, categories).
 *
 * The stock palette is deliberately small and muted — it keeps the UI calm.
 * On top of it every hub keeps its own custom palette in the shared settings
 * (one hub-wide list, like the default currency): the stock eight turned out
 * to be nowhere near enough. PEOPLE WANT MORE.
 */

export const PALETTE = [
  '#1F6E8C',
  '#6B8F5E',
  '#C4842B',
  '#8C4A6B',
  '#4A6B8C',
  '#8C6B4A',
  '#5A6A74',
  '#7A5C9E',
];

export const PALETTE_KEY = 'palette.custom';

/** Hard cap: the settings value is limited to 500 chars server-side. */
export const PALETTE_MAX = 24;

const HEX = /^#[0-9a-f]{6}$/i;

/** Parse the stored palette defensively: settings are free-form strings. */
export function parsePalette(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return [...new Set(parsed.map((c) => String(c).toLowerCase()).filter((c) => HEX.test(c)))].slice(
      0,
      PALETTE_MAX,
    );
  } catch {
    return [];
  }
}

export async function loadCustomPalette(): Promise<string[]> {
  const settings = await api.get<Record<string, string>>('/settings');
  return parsePalette(settings[PALETTE_KEY]);
}

/**
 * Add a color to the hub palette. Stock colors and duplicates are skipped —
 * the palette only accumulates what is genuinely new.
 */
export async function addToPalette(color: string): Promise<string[]> {
  const hex = color.toLowerCase();
  if (!HEX.test(hex)) return loadCustomPalette();
  const current = await loadCustomPalette();
  if (current.includes(hex) || PALETTE.some((c) => c.toLowerCase() === hex)) return current;
  const next = [...current, hex].slice(0, PALETTE_MAX);
  await api.patch('/settings', { [PALETTE_KEY]: JSON.stringify(next) });
  return next;
}

export async function removeFromPalette(color: string): Promise<string[]> {
  const current = await loadCustomPalette();
  const next = current.filter((c) => c !== color.toLowerCase());
  await api.patch('/settings', { [PALETTE_KEY]: JSON.stringify(next) });
  return next;
}
