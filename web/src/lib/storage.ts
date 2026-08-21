/**
 * Device-local preferences. What lives here is a property of the screen,
 * not of the family: the hallway kiosk and the phone in the pocket keep
 * their own view settings and dashboard layouts.
 */
export function loadLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveLocal(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private browsing may forbid writes — no reason to crash
  }
}
