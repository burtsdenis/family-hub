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
  it('целые и дробные, оба разделителя', () => {
    expect(parseAmount('1234')).toBe(123400);
    expect(parseAmount('1234.56')).toBe(123456);
    expect(parseAmount('1234,56')).toBe(123456);
    expect(parseAmount('0.5')).toBe(50);
    expect(parseAmount('0')).toBe(0);
  });

  it('группировка тысяч: десятичный разделитель — тот, что правее', () => {
    expect(parseAmount('1,234.56')).toBe(123456);
    expect(parseAmount('1.234,56')).toBe(123456);
    expect(parseAmount('1 234.56')).toBe(123456);
    expect(parseAmount('1 234,56')).toBe(123456);
  });

  it('одиночный разделитель с тремя знаками — двусмысленность, отказ', () => {
    // «1,500» — то ли полторы тысячи, то ли полтора: лучше честный отказ,
    // чем молчаливая ошибка в тысячу раз. Поле ввода такое не порождает
    // (formatAmountInput не группирует), а вставку из буфера с группировкой
    // спасает вариант с обоими разделителями выше (там разделитель тысяч
    // определяется однозначно).
    expect(parseAmount('1,500')).toBeNull();
    expect(parseAmount('1.500')).toBeNull();
  });

  it('мусор и отрицательные — null', () => {
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('12.345')).toBeNull(); // три знака после точки — не сумма
    expect(parseAmount('-5')).toBeNull();
    expect(parseAmount('1..2')).toBeNull();
  });

  it('копейки не теряются на округлении', () => {
    // 19.99 * 100 = 1998.9999… в плавающей точке — Math.round обязателен
    expect(parseAmount('19.99')).toBe(1999);
    expect(parseAmount('0.07')).toBe(7);
  });
});

describe('formatAmountInput → parseAmount: round-trip', () => {
  // Поле ввода обязано показывать то, что разбор гарантированно примет
  // обратно — реальный баг: локализованное «1,500» разбиралось как 1.5
  it.each([0, 1, 99, 100, 123456, 150000, 999999999, 1999, 7])(
    'минорные %i выживают round-trip',
    (minor) => {
      expect(parseAmount(formatAmountInput(minor))).toBe(minor);
    },
  );

  it('формат без локали и группировки', () => {
    expect(formatAmountInput(150000)).toBe('1500');
    expect(formatAmountInput(123456)).toBe('1234.56');
  });
});

describe('normalizeRule / describeRule', () => {
  it('INTERVAL=1 сводится к канонической форме без интервала', () => {
    // База и сидинг хранят с ;INTERVAL=1, интерфейс — без: формы эквивалентны
    expect(normalizeRule('FREQ=MONTHLY;INTERVAL=1')).toBe('FREQ=MONTHLY');
    expect(normalizeRule('freq=weekly;interval=1')).toBe('FREQ=WEEKLY');
    expect(normalizeRule('FREQ=MONTHLY;INTERVAL=3')).toBe('FREQ=MONTHLY;INTERVAL=3');
  });

  it('не-RRULE возвращается как есть', () => {
    expect(normalizeRule('каждый вторник')).toBe('каждый вторник');
  });

  it('описание не показывает сырой RRULE человеку', () => {
    // Тесты идут с языком en (дефолт без localStorage)
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

  it('дети идут сразу за родителем с глубиной 1', () => {
    const ordered = orderCategories([cat('fuel', 'car'), cat('car'), cat('food')]);
    expect(ordered.map((o) => [o.category.id, o.depth])).toEqual([
      ['car', 0],
      ['fuel', 1],
      ['food', 0],
    ]);
  });

  it('подкатегория со скрытым родителем поднимается на верхний уровень', () => {
    // Родителя нет в пуле (в архиве) — ребёнок не должен исчезнуть
    const ordered = orderCategories([cat('fuel', 'car-archived')]);
    expect(ordered).toEqual([{ category: cat('fuel', 'car-archived'), depth: 0 }]);
  });

  it('фильтр по kind не ломает связку родитель-ребёнок', () => {
    const ordered = orderCategories(
      [cat('car'), cat('fuel', 'car'), cat('salary', null, 'income')],
      'expense',
    );
    expect(ordered.map((o) => o.category.id)).toEqual(['car', 'fuel']);
  });
});
