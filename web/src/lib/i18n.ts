import { en, enPlurals } from './i18n.en';

/*
  Internationalization. Approach: Russian strings are the dictionary keys.

  Code keeps t('Сохранить'); the English dictionary (i18n.en.ts) supplies
  the translation, Russian is the identity. What this buys:

  — the Russian locale is complete by construction, no dictionary needed;
  — a key missing from the en dictionary is visible (shows up in Russian)
    but breaks nothing;
  — server errors are translated by the same t() in one place (lib/api.ts):
    the server sends Russian text, the client shows it in the UI language.

  Language is a device setting (localStorage), not an account one: the
  wife's phone and a shared kiosk may speak different languages. Default is
  English. Switching languages reloads the page: it is a one-off action,
  and the reload removes the need for reactive plumbing — t() stays a pure
  function, usable outside React too.
*/

export type Lang = 'en' | 'ru';

const STORAGE_KEY = 'hub-lang';

function readLang(): Lang {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === 'ru' ? 'ru' : 'en';
  } catch {
    return 'en';
  }
}

export const lang: Lang = readLang();

// Document attributes follow the chosen language. index.html statically
// declares English (the default); here it is corrected to the actual one:
// the tab title and lang for screen readers must match the UI language.
// The document check is because the module is also imported in Node (tests).
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.title = lang === 'ru' ? 'Дом' : 'Family Hub';
}

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode without localStorage — the language just won't stick
  }
  window.location.reload();
}

/** Translate a string. Substitutions: {name} from params. */
export function t(key: string, params?: Record<string, string | number>): string {
  let out = lang === 'ru' ? key : (en[key] ?? key);
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      out = out.replaceAll(`{${name}}`, String(value));
    }
  }
  return out;
}

/**
 * Pluralization. Forms are given as the Russian triple (день/дня/дней) —
 * which doubles as the key for the English pair in enPlurals.
 */
export function tPlural(n: number, forms: [string, string, string]): string {
  if (lang === 'ru') {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return forms[1];
    return forms[2];
  }
  const pair = enPlurals[forms[0]];
  if (!pair) return en[forms[0]] ?? forms[0];
  return n === 1 ? pair[0] : pair[1];
}

/** Locale for Intl date and number formatters. */
export const intlLocale = lang === 'ru' ? 'ru-RU' : 'en-GB';
