import { useSyncExternalStore } from 'react';

/*
  One shared way to say "that did not save" (#85).

  Dialogs surface their own errors next to their own Save button, and that
  stays the rule. But the app also has inline actions with no dialog to
  put a message in — ticking a task done, revoking an invite — and each of
  them had nothing: the promise rejected into the console and the screen
  said nothing. An inline error field is awkward exactly where those
  actions live (a task row, a settings list), which is why they ended up
  silent.

  So: a module-scope value mirrored into React, same shape as
  lib/experiment.ts. reportFailure() is for actions WITHOUT their own
  error surface — a dialog must keep using its local state, where the
  message sits next to the thing that failed.
*/

let current: { message: string; at: number } | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/** Show the message in the failure toast (see AppShell). */
export function reportFailure(message: string): void {
  // `at` makes repeats distinct: failing the same action twice must
  // restart the toast timer, and an identical object would not re-render
  current = { message, at: Date.now() };
  notify();
}

export function clearFailure(): void {
  current = null;
  notify();
}

export function useFailure(): { message: string; at: number } | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}
