import { describe, expect, it } from 'vitest';
import {
  describeRule,
  formatAmountInput,
  normalizeRule,
  orderCategories,
  parseAmount,
  type Category,
} from './money';

describe('parseAmount', () => {
  it('integers and decimals, both separators', () => {
    expect(parseAmount('1234')).toBe(123400);
    expect(parseAmount('1234.56')).toBe(123456);
    expect(parseAmount('1234,56')).toBe(123456);
    expect(parseAmount('0.5')).toBe(50);
    expect(parseAmount('0')).toBe(0);
  });

  it('thousands grouping: the decimal separator is the rightmost one', () => {
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('1 234.56')).toBe(123456);
    expect(parseAmount('1 234,56')).toBe(123456);
  });

  it('single separator with three digits is ambiguous — reject', () => {
    // «1,500» — fifteen hundred or one and a half: an honest rejection
    // beats a silent thousand-fold error. Input fields never produce this
    // (formatAmountInput doesn't group), and pasting grouped text from the
    // clipboard is saved by the both-separators case above (there the
    // thousands separator is unambiguous).
    expect(parseAmount('1,500')).toBeNull();
    expect(parseAmount('1.500')).toBeNull();
  });

  it('garbage and negatives — null', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12.345')).toBeNull(); // three digits after the dot is not an amount
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1..2')).toBeNull();
  });

  it('cents survive rounding', () => {
    // 19.99 * 100 = 1998.9999… in floating point — Math.round is mandatory
    expect(parseAmount('19.99')).toBe(1999);
    expect(parseAmount('0.07')).toBe(7);
  });
});

describe('formatAmountInput → parseAmount: round-trip', () => {
  // The input field must show what the parser is guaranteed to accept
  // back — real bug: localized «1,500» parsed as 1.5
  it.each([0, 1, 99, 100, 123456, 150000, 999999999, 1999, 7])(
    'minor units %i survive the round-trip',
    (minor) => {
      expect(parseAmount(formatAmountInput(minor))).toBe(minor);
    },
  );

  it('formats without locale or grouping', () => {
    expect(formatAmountInput(150000)).toBe('1500');
    expect(formatAmountInput(123456)).toBe('1234.56');
  });
});

describe('normalizeRule / describeRule', () => {
  it('INTERVAL=1 reduces to the canonical interval-free form', () => {
    // The db and seeding store ;INTERVAL=1, the UI goes without: equivalent forms
    expect(normalizeRule('FREQ=MONTHLY;INTERVAL=1')).toBe('FREQ=MONTHLY');
    expect(normalizeRule('freq=weekly;interval=1')).toBe('FREQ=WEEKLY');
    expect(normalizeRule('FREQ=MONTHLY;INTERVAL=3')).toBe('FREQ=MONTHLY;INTERVAL=3');
  });

  it('non-RRULE strings pass through unchanged', () => {
    expect(normalizeRule('каждый вторник')).toBe('каждый вторник');
  });

  it('the description never shows raw RRULE to a human', () => {
    // Tests run with lang en (the default without localStorage)
    expect(describeRule('FREQ=MONTHLY;INTERVAL=1')).toBe('Every month');
    expect(describeRule('FREQ=MONTHLY')).toBe('Every month');
    expect(describeRule('FREQ=MONTHLY;INTERVAL=6')).toBe('Every 6 months');
    expect(describeRule('FREQ=DAILY;INTERVAL=10')).toBe('Every 10 days');
  });
});

describe('orderCategories', () => {
  const cat = (id: string, parent: string | null = null, kind: 'expense' | 'income' = 'expense'): Category => ({
    id,
    name: id,
    kind,
    color: '#000000',
    parent_id: parent,
  });

  it('children follow their parent immediately at depth 1', () => {
    const ordered = orderCategories([cat('fuel', 'car'), cat('car'), cat('food')]);
    expect(ordered.map((o) => [o.category.id, o.depth])).toEqual([
      ['car', 0],
      ['fuel', 1],
      ['food', 0],
    ]);
  });

  it('a subcategory with a hidden parent is promoted to the top level', () => {
    // The parent is not in the pool (archived) — the child must not vanish
    const ordered = orderCategories([cat('fuel', 'car-archived')]);
    expect(ordered).toEqual([{ category: cat('fuel', 'car-archived'), depth: 0 }]);
  });

  it('filtering by kind keeps the parent-child pairing intact', () => {
    const ordered = orderCategories(
      [cat('car'), cat('fuel', 'car'), cat('salary', null, 'income')],
      'expense',
    );
    expect(ordered.map((o) => o.category.id)).toEqual(['car', 'fuel']);
  });
});
