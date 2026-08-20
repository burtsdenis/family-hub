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

describe('applyPlaceholders', () => {
  it('formats {{date}} in the requested locale, English without one', async () => {
    const { applyPlaceholders } = await import('./notes.js');
    const russian = applyPlaceholders('{{date}}', 'Alex', 'ru-RU');
    const english = applyPlaceholders('{{date}}', 'Alex');
    // Month names are the tell: Cyrillic in ru-RU, Latin otherwise.
    // Exact strings would chase the clock; the alphabet does not.
    expect(russian).toMatch(/[а-яё]/i);
    expect(english).not.toMatch(/[а-яё]/i);
    // The Russian placeholder KEYS keep working regardless of locale —
    // they are data compatibility, not language choice
    expect(applyPlaceholders('{{автор}}', 'Alex')).toBe('Alex');
  });

  it('survives a malformed locale tag instead of throwing', async () => {
    const { applyPlaceholders } = await import('./notes.js');
    expect(() => applyPlaceholders('{{date}}', 'Alex', 'not a tag')).not.toThrow();
  });
});
