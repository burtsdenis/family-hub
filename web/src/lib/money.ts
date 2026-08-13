import { intlLocale, t } from './i18n';
import { plural } from './format';
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
  /** Balance as of the last reconciliation — what the actual is compared against. */
  checked_balance: number | null;
}

export interface Category {
  id: string;
  name: string;
  kind: 'expense' | 'income';
  color: string;
  /** Parent category. Hierarchy is exactly one level deep. */
  parent_id: string | null;
}

/**
 * Categories in display order: parent, then its subcategories right after.
 * A subcategory whose parent is hidden (archived) is promoted to the top
 * level — otherwise it would vanish from every list.
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
 * One-click currencies. Any other three-letter ISO 4217 code is typed in
 * by hand — the server accepts anything, Intl handles the formatting.
 */
export const COMMON_CURRENCIES = ['EUR', 'RSD', 'USD', 'GBP', 'CHF', 'PLN', 'CZK', 'SEK', 'HUF'];

/**
 * Amounts are integers everywhere, in minor units: 1234.56 → 123456.
 * Floating point in money produces rounding error that accumulates in
 * totals and eventually disagrees with the bank.
 */
export function formatMoney(minor: number, currency: string): string {
  // Show cents only when present: dinars usually have none, and
  // «2 345,00 RSD» instead of «2 345 RSD» is just noise
  const fraction = minor % 100 === 0 ? 0 : 2;
  try {
    return new Intl.NumberFormat(intlLocale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    }).format(minor / 100);
  } catch {
    // Intl rejects unknown currency codes — show it as is
    return `${(minor / 100).toLocaleString(intlLocale, {
      minimumFractionDigits: fraction,
      maximumFractionDigits: 2,
    })} ${currency}`;
  }
}

/** Without the currency sign — for compact spots where the amount is read-only. */
export function formatAmount(minor: number): string {
  const fraction = minor % 100 === 0 ? 0 : 2;
  return (minor / 100).toLocaleString(intlLocale, {
    minimumFractionDigits: fraction,
    maximumFractionDigits: 2,
  });
}

/**
 * Format for input fields: no locale, no grouping, dot as the separator.
 *
 * The localized formatAmount won't do here: the English locale inserts a
 * thousands comma («1,500»), which parseAmount took for a decimal point
 * and rejected the string — editing a transaction meant retyping the
 * amount even when it hadn't changed. The field must show what the parser
 * is guaranteed to accept back.
 */
export function formatAmountInput(minor: number): string {
  const value = minor / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * Parse an entered amount into minor units.
 * Accepts «1234,56», «1 234.56», «1,234.56», «1.234,56», «1234».
 * Returns null if not a number.
 */
export function parseAmount(input: string): number | null {
  let cleaned = input.replace(/[\s\u00a0]/g, '');

  // When both separators are present, the decimal one is the rightmost,
  // the other groups thousands: «1,234.56» and «1.234,56» are equivalent.
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

/** Accounts grouped by currency: no grand total without an exchange rate. */
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

const RULE_UNITS: Record<string, [string, string, string]> = {
  DAILY: ['день', 'дня', 'дней'],
  WEEKLY: ['неделю', 'недели', 'недель'],
  MONTHLY: ['месяц', 'месяца', 'месяцев'],
  YEARLY: ['год', 'года', 'лет'],
};

/**
 * Canonical rule form: INTERVAL=1 is dropped.
 * The server and seeding store "FREQ=MONTHLY;INTERVAL=1" while the UI lists
 * operate on "FREQ=MONTHLY" — the forms are equivalent but not string-equal,
 * and without normalization the label showed raw RRULE and the edit dialog's
 * select could not find its option.
 */
export function normalizeRule(rule: string): string {
  const m = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;INTERVAL=(\d+))?$/.exec(
    rule.trim().toUpperCase(),
  );
  if (!m) return rule;
  const interval = Number(m[2] ?? 1);
  return interval === 1 ? `FREQ=${m[1]}` : `FREQ=${m[1]};INTERVAL=${interval}`;
}

export function describeRule(rule: string): string {
  const canonical = normalizeRule(rule);
  const known = RULE_LABEL[canonical];
  if (known) return known;

  // A rule outside the preset list (say, "every 6 months" via the API) —
  // build an honest description instead of showing RRULE to a human
  const m = /^FREQ=([A-Z]+);INTERVAL=(\d+)$/.exec(canonical);
  const units = m ? RULE_UNITS[m[1]!] : undefined;
  if (!m || !units) return rule;
  const n = Number(m[2]);
  return `${t('Каждые')} ${n} ${plural(n, ...units)}`;
}
