import { describe, expect, it } from 'vitest';
import { excerptOf } from './notes.js';

describe('excerptOf', () => {
  it('strips markdown syntax, keeps the text (Cyrillic content included)', () => {
    expect(excerptOf('**500 g** flour · `10 g` salt')).toBe('500 g flour · 10 g salt');
    expect(excerptOf('- Milk\n- Eggs\n- Paint tape (see [[Repaint the hallway]])')).toBe(
      'Milk Eggs Paint tape (see Repaint the hallway)',
    );
    expect(excerptOf('# Заголовок\n> цитата\n1. пункт [ссылка](https://x.y)')).toBe(
      'Заголовок цитата пункт ссылка',
    );
    expect(excerptOf('![фото](img.png) текст после картинки')).toBe('текст после картинки');
    expect(excerptOf('- [ ] купить\n- [x] сделано')).toBe('купить сделано');
  });

  it('cuts to 120 chars and collapses whitespace', () => {
    expect(excerptOf(`а${'  \n'.repeat(10)}б`)).toBe('а б');
    expect(excerptOf('я'.repeat(500))).toHaveLength(120);
  });
});
