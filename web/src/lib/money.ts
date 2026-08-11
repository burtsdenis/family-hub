import { intlLocale, t } from './i18n';
export type AccountKind = 'cash' | 'card' | 'savings';
export type TxKind = 'expense' | 'income' | 'transfer';

export interface Account {
  id: string;
  name: string;
  currency: string;
  kind: AccountKind;
  opening_balance: number;
  owner_id: string | null;
  owner_name: string | null;
  shared: number;
  color: string;
  archived_at: string | null;
  balance: number;
  tx_count: number;
  last_actual: number | null;
  last_checked_on: string | null;
  /** Остаток на момент последней сверки — с ним и сравнивается актуал. */
  checked_balance: number | null;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  color: string;
  /** Родительская категория. Глубина иерархии — один уровень. */
  parent_id: string | null;
}

/**
 * Категории в порядке показа: родитель, сразу за ним его подкатегории.
 * Подкатегория, чей родитель скрыт (в архиве), поднимается на верхний
 * уровень — иначе она бы исчезла из всех списков.
 */
export function orderCategories(
  categories: Category[],
  kind?: 'expense' | 'income',
): { category: Category; depth: 0 | 1 }[] {
  const pool = kind ? categories.filter((c) => c.kind === kind) : categories;
  const ids = new Set(pool.map((c) => c.id));
  const childrenOf = new Map<string, Category[]>();
  const roots: Category[] = [];

  for (const c of pool) {
    if (c.parent_id && ids.has(c.parent_id)) {
      const list = childrenOf.get(c.parent_id) ?? [];
      list.push(c);
      childrenOf.set(c.parent_id, list);
    } else {
      roots.push(c);
    }
  }

  const out: { category: Category; depth: 0 | 1 }[] = [];
  for (const root of roots) {
    out.push({ category: root, depth: 0 });
    for (const child of childrenOf.get(root.id) ?? []) {
      out.push({ category: child, depth: 1 });
    }
  }
  return out;
}

export interface Transaction {
  id: string;
  kind: TxKind;
  occurred_on: string;
  account_id: string;
  account_name: string;
  account_color: string;
  currency: string;
  amount: number;
  to_account_id: string | null;
  to_account_name: string | null;
  to_currency: string | null;
  to_amount: number | null;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  note: string | null;
  place: string | null;
  author_name: string | null;
  receipts: number;
}

export interface Summary {
  from: string;
  to: string;
  byCurrency: { currency: string; kind: string; total: number }[];
  byCategory: {
    currency: string;
    category_id: string | null;
    category_name: string | null;
    color: string | null;
    kind: string | null;
    parent_id: string | null;
    total: number;
    count: number;
  }[];
}

export const ACCOUNT_KIND_LABEL: Record<AccountKind, string> = {
  cash: t('Наличные'),
  card: t('Карта'),
  savings: t('Копилка'),
};

export const TX_KIND_LABEL: Record<TxKind, string> = {
  expense: t('Трата'),
  income: t('Доход'),
  transfer: t('Перевод'),
};

/**
 * Валюты, которые заводятся в один клик. Любой другой трёхбуквенный код
 * ISO 4217 вводится руками — сервер принимает любой, Intl отформатирует.
 */
export const COMMON_CURRENCIES = ['EUR', 'RSD', 'USD', 'GBP', 'CHF', 'PLN', 'CZK', 'SEK', 'HUF'];

/**
 * Суммы везде целые, в минорных единицах: 1234.56 → 123456.
 * Числа с плавающей точкой в деньгах дают ошибку округления, которая
 * копится в суммах и в итоге расходится с банком.
 */
export function formatMoney(minor: number, currency: string): string {
  // Копейки показываем только когда они есть: в динарах их обычно нет,
  // и «2 345,00 RSD» вместо «2 345 RSD» лишний шум
  const fraction = minor % 100 === 0 ? 0 : 2;
  try {
    return new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    // Неизвестный код валюты Intl не примет — показываем как есть
    return `${(minor / 100).toLocaleString(intlLocale, {
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    })} ${currency}`;
  }
}

/** Без знака валюты — для компактных мест, где сумму только читают. */
export function formatAmount(minor: number): string {
  const fraction = minor % 100 === 0 ? 0 : 2;
  return (minor / 100).toLocaleString(intlLocale, {
    minimumFractionDigits: fraction,
    maximumFractionDigits: 2,
  });
}

/**
 * Формат для полей ввода: без локали и группировки, точка как разделитель.
 *
 * Локализованный formatAmount сюда не годится: английская локаль ставит
 * запятую тысяч («1,500»), которую parseAmount принимал за десятичную
 * точку и отклонял строку — при редактировании операции сумму приходилось
 * вводить заново, даже если она не менялась. Поле должно показывать то,
 * что разбор гарантированно примет обратно.
 */
export function formatAmountInput(minor: number): string {
  const value = minor / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Разбор введённой суммы в минорные единицы.
 * Принимает «1234,56», «1 234.56», «1,234.56», «1.234,56», «1234».
 * Возвращает null, если не число.
 */
export function parseAmount(input: string): number | null {
  let cleaned = input.replace(/[\s\u00a0]/g, '');

  // Если есть оба разделителя, десятичный — тот, что правее,
  // второй группирует тысячи: «1,234.56» и «1.234,56» равнозначны.
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  if (lastComma !== -1 && lastDot !== -1) {
    cleaned =
      lastDot > lastComma
        ? cleaned.replaceAll(',', '')
        : cleaned.replaceAll('.', '').replace(',', '.');
  } else {
    cleaned = cleaned.replace(',', '.');
  }

  if (cleaned === '' || !/^\d*\.?\d{0,2}$/.test(cleaned)) return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

export function monthBounds(anchor: string): { from: string; to: string } {
  const from = `${anchor.slice(0, 7)}-01`;
  const d = new Date(`${from}T00:00:00Z`);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
  return { from, to: last.toISOString().slice(0, 10) };
}

/** Счета по валютам: общего итога без курса не бывает. */
export function groupByCurrency(accounts: Account[]): { currency: string; total: number; items: Account[] }[] {
  const map = new Map<string, Account[]>();
  for (const a of accounts) {
    const list = map.get(a.currency) ?? [];
    list.push(a);
    map.set(a.currency, list);
  }
  return [...map.entries()]
    .map(([currency, items]) => ({
      currency,
      total: items.reduce((sum, a) => sum + a.balance, 0),
      items,
    }))
    .sort((a, b) => b.total - a.total);
}

const RULE_LABEL: Record<string, string> = {
  'FREQ=DAILY': t('Каждый день'),
  'FREQ=WEEKLY': t('Каждую неделю'),
  'FREQ=WEEKLY;INTERVAL=2': t('Раз в две недели'),
  'FREQ=MONTHLY': t('Каждый месяц'),
  'FREQ=MONTHLY;INTERVAL=3': t('Раз в квартал'),
  'FREQ=YEARLY': t('Каждый год'),
};

export function describeRule(rule: string): string {
  return RULE_LABEL[rule] ?? rule;
}
