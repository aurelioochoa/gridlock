import { describe, expect, it } from 'vitest';
import { TABLES } from './index';
import { en } from './en';

const holes = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe('string tables', () => {
  const keys = Object.keys(en).sort();
  for (const [lang, table] of Object.entries(TABLES)) {
    it(`${lang} has exactly the English keys, each with the same placeholders`, () => {
      expect(Object.keys(table).sort()).toEqual(keys);
      for (const k of keys) {
        const v = table[k as keyof typeof en];
        expect(v.trim().length, `${lang} ${k} is empty`).toBeGreaterThan(0);
        expect(holes(v), `${lang} ${k}`).toEqual(holes(en[k as keyof typeof en]));
      }
    });
  }
  it('ships all eight site languages', () => {
    expect(Object.keys(TABLES).sort()).toEqual(['de', 'en', 'es', 'fr', 'ko', 'no', 'pt', 'zh']);
  });
});
