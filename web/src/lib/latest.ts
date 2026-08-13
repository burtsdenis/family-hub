import { useCallback, useRef } from 'react';

/**
 * Guard against stale responses.
 *
 * When the filter or range changes faster than the server responds,
 * replies arrive out of request order. The last one in overwrites state —
 * and the screen ends up showing data for the wrong range. This only
 * reproduces in a live browser: locally everything responds instantly.
 *
 * Usage:
 *   const isLatest = useLatest();
 *   const load = useCallback(async () => {
 *     const fresh = isLatest();
 *     const data = await api.get(...);
 *     if (!fresh()) return;   // something else was requested meanwhile
 *     setState(data);
 *   }, [...]);
 *
 * The returned function must be stable (useCallback with no deps): it
 * sits in load's dependencies on every page, and load sits in the loading
 * effect's dependencies. A new function on every render closed this into
 * a loop of "request → setState → render → new load → effect → request":
 * pages reloaded data endlessly, burning tab memory and the server's
 * rate limits.
 */
export function useLatest(): () => () => boolean {
  const seq = useRef(0);
  return useCallback(() => {
    const mine = ++seq.current;
    return () => mine === seq.current;
  }, []);
}
