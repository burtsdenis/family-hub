import { afterEach, describe, expect, it, vi } from 'vitest';

/*
  i18n is module-level state (the language is read once at import), so each
  case stubs localStorage and imports a fresh copy of the module.
*/
async function loadI18n(language: string | null) {
  vi.resetModules();
  vi.stubGlobal('localStorage', {
    getItem: () => language,
    setItem: () => {},
  });
  return import('./i18n');
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('t', () => {
  it('English is the identity, unknown keys pass through', async () => {
    const { t } = await loadI18n(null);
    expect(t('Save')).toBe('Save');
    expect(t('Never seen before')).toBe('Never seen before');
  });

  it('Russian comes from the dictionary, unknown keys fall back to English', async () => {
    const { t } = await loadI18n('ru');
    expect(t('Save')).toBe('Сохранить');
    expect(t('Never seen before')).toBe('Never seen before');
  });

  it('params substitute in both languages', async () => {
    const en = await loadI18n(null);
    expect(en.t('{n} B', { n: 42 })).toBe('42 B');
    const ru = await loadI18n('ru');
    expect(ru.t('{n} B', { n: 42 })).toBe('42 Б');
  });
});

describe('tPlural', () => {
  it('English pair: 1 is singular, everything else plural', async () => {
    const { tPlural } = await loadI18n(null);
    expect(tPlural(1, ['day', 'days'])).toBe('day');
    expect(tPlural(2, ['day', 'days'])).toBe('days');
    expect(tPlural(21, ['day', 'days'])).toBe('days');
  });

  it('Russian gets the full three-form declension', async () => {
    const { tPlural } = await loadI18n('ru');
    expect(tPlural(1, ['day', 'days'])).toBe('день');
    expect(tPlural(2, ['day', 'days'])).toBe('дня');
    expect(tPlural(5, ['day', 'days'])).toBe('дней');
    expect(tPlural(11, ['day', 'days'])).toBe('дней');
    expect(tPlural(21, ['day', 'days'])).toBe('день');
    expect(tPlural(102, ['task', 'tasks'])).toBe('задачи');
  });
});
