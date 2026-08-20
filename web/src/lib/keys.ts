import type { KeyboardEvent } from 'react';

/**
 * Enter submits the form.
 *
 * Relying on the browser's implicit form submission proved unreliable:
 * behavior differs across fields, browsers and the on-screen keyboard.
 * Cheaper to handle it explicitly wherever a person might press Enter.
 *
 * CJK and other composed input stays intact: while typing through an IME
 * the browser sets isComposing, and Enter there means "confirm the
 * character", not "submit".
 */
export function onEnter<T extends HTMLElement>(action: () => void) {
  return (e: KeyboardEvent<T>) => {
    if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    action();
  };
}

/**
 * Dialog keys, listened for at the window level: Enter runs the primary
 * action, Escape closes — wherever the focus is, not just in a text field
 * with its own handler.
 *
 * Enter is skipped where it already has a job: in a textarea and the
 * editor it inserts a line break, on a button or link it presses them.
 * The field-level onEnter handler fires first and sets defaultPrevented,
 * so submission never doubles.
 *
 * A button marked data-chip is the exception. A real mouse click focuses
 * the clicked button, so after picking a category chip the focus sits on
 * it and the button-skip ate the Enter that meant "save" — pressing it
 * again just toggled the chip (#70). A chip is a selection, not an
 * action: once it is picked, Enter means "done". preventDefault also
 * stops the browser's own Enter-presses-the-focused-button, so the chip
 * does not un-toggle while the dialog saves.
 */
export function dialogKeys(submit: () => void, close: () => void) {
  return (e: globalThis.KeyboardEvent) => {
    if (e.key === 'Escape') {
      close();
      return;
    }
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.defaultPrevented) return;
    const target = e.target as HTMLElement | null;
    const isChip = target?.dataset['chip'] !== undefined;
    if (
      target &&
      !isChip &&
      (target.tagName === 'TEXTAREA' ||
        target.tagName === 'BUTTON' ||
        target.tagName === 'A' ||
        target.isContentEditable)
    ) {
      return;
    }
    e.preventDefault();
    submit();
  };
}
