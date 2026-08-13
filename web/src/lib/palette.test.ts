import { describe, expect, it } from 'vitest';
import { PALETTE_MAX, parsePalette } from './palette';

describe('parsePalette', () => {
  it('parses a stored JSON array of hex colors', () => {
    expect(parsePalette('["#AABBCC", "#123456"]')).toEqual(['#aabbcc', '#123456']);
  });

  it('is defensive: settings are free-form strings', () => {
    expect(parsePalette(undefined)).toEqual([]);
    expect(parsePalette('')).toEqual([]);
    expect(parsePalette('not json')).toEqual([]);
    expect(parsePalette('{"a":1}')).toEqual([]);
    expect(parsePalette('["red", "#12345", "#1234567", 42, "#abcdef"]')).toEqual(['#abcdef']);
  });

  it('dedupes case-insensitively and enforces the cap', () => {
    expect(parsePalette('["#AABBCC", "#aabbcc"]')).toEqual(['#aabbcc']);
    const many = JSON.stringify(
      Array.from({ length: 40 }, (_, i) => `#${String(100000 + i).slice(0, 6)}`),
    );
    expect(parsePalette(many)).toHaveLength(PALETTE_MAX);
  });
});
