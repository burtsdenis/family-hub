import { en, enPlurals } from './i18n.en';

/*
  Интернационализация. Подход: русские строки — ключи словаря.

  В коде остаётся t('Сохранить'); английский словарь (i18n.en.ts) отдаёт
  перевод, русский язык — тождество. Что это даёт:

  — русская локаль полна по построению, словарь для неё не нужен;
  — пропущенный в en-словаре ключ виден (покажется по-русски),
    но ничего не ломает;
  — ошибки сервера переводятся той же t() в одной точке (lib/api.ts):
    сервер шлёт русский текст, клиент показывает на языке интерфейса.

  Язык — настройка устройства (localStorage), а не учётки: телефон жены
  и общий стенд могут говорить на разных языках. По умолчанию английский.
  Смена языка перезагружает страницу: это одноразовое действие,
  и перезагрузка избавляет от реактивной обвязки — t() остаётся
  чистой функцией, пригодной и вне React.
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

// Атрибуты документа — под выбранный язык. index.html статически заявляет
// английский (язык по умолчанию), здесь он уточняется по факту: заголовок
// вкладки и lang для читалок должны совпадать с языком интерфейса.
// Проверка на document — модуль импортируется и в Node (тесты).
if (typeof document !== 'undefined') {
  document.documentElement.lang = lang;
  document.title = lang === 'ru' ? 'Дом' : 'Family Hub';
}

export function setLang(next: Lang): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Приватный режим без localStorage — язык просто не запомнится
  }
  window.location.reload();
}

/** Перевод строки. Подстановки — {name} из params. */
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
 * Множественное число. Формы задаются русской тройкой (день/дня/дней) —
 * она же ключ для английской пары в enPlurals.
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

/** Локаль для Intl-форматтеров дат и чисел. */
export const intlLocale = lang === 'ru' ? 'ru-RU' : 'en-GB';
