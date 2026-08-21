import { describe, expect, it } from 'vitest';
import { splitCenterLabel } from './DonutChart';

/*
  The centre label against real Intl output. The fixtures are the exact
  strings formatMoney produces (NBSP thousands separators included) —
  the production regression was "378 264,09 RSD" splitting at the first
  NBSP into "378" over "264,09 RSD".
*/
const NBSP = ' ';

describe('splitCenterLabel', () => {
  it('code-first locales split after the code (en-GB RSD)', () => {
    expect(splitCenterLabel(`RSD${NBSP}378,264.09`)).toEqual({
      unit: 'RSD',
      amount: '378,264.09',
    });
  });

  it('code-last locales split before the code, thousands NBSPs intact (ru-RU RSD)', () => {
    expect(splitCenterLabel(`378${NBSP}264,09${NBSP}RSD`)).toEqual({
      unit: 'RSD',
      amount: `378${NBSP}264,09`,
    });
  });

  it('trailing symbol with spaced thousands (ru-RU EUR)', () => {
    expect(splitCenterLabel(`2${NBSP}641,00${NBSP}€`)).toEqual({
      unit: '€',
      amount: `2${NBSP}641,00`,
    });
  });

  it('small ru amount — one separator, still the right cut', () => {
    expect(splitCenterLabel(`127,40${NBSP}RSD`)).toEqual({ unit: 'RSD', amount: '127,40' });
  });

  it('spaceless labels stay on one line (en-GB EUR)', () => {
    expect(splitCenterLabel('€2,641.00')).toBeNull();
  });

  it('a bare number with separators is left alone rather than guessed at', () => {
    expect(splitCenterLabel(`1${NBSP}234,56`)).toBeNull();
  });
});
