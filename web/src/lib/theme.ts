/*
  The theme is applied here, at module scope, not inside AppShell: the
  sign-in, first-run, invite and forced-password screens all render
  before the shell ever mounts, and used to flash full-brightness light
  regardless of the saved choice or the system preference (#52). Same
  shape as i18n.ts setting document.documentElement.lang — the things
  the whole document needs must not wait for a session.

  Applying at import time also removes the brief flash of the wrong
  theme on load for signed-in users: the class is set before React
  renders anything.
*/

const KEY = 'hub.theme';

export function initialDark(): boolean {
  // Private-mode Safari throws on storage access rather than returning null
  try {
    const saved = localStorage.getItem(KEY);
    if (saved) return saved === 'dark';
  } catch {
    /* fall through to the system preference */
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export function applyTheme(dark: boolean): void {
  document.documentElement.classList.toggle('dark', dark);
}

export function persistTheme(dark: boolean): void {
  try {
    localStorage.setItem(KEY, dark ? 'dark' : 'light');
  } catch {
    /* nothing to persist to — the choice just will not survive a reload */
  }
}

applyTheme(initialDark());
