import type { FocusEvent } from 'react';

/**
 * onBlur for text fields: a whitespace-only value looks empty to the
 * person but does not behave as empty — the placeholder never comes
 * back, and some forms would even save the spaces. Clearing on blur
 * makes "looks empty" and "is empty" the same thing. Real text
 * (anything with a non-space character) is left untouched.
 */
export function clearBlankOnBlur(clear: () => void) {
  return (e: FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.target.value === '' || e.target.value.trim() !== '') return;
    // Uncontrolled fields (the note title) keep their value in the DOM,
    // where a state update alone would not reach
    e.target.value = '';
    clear();
  };
}
