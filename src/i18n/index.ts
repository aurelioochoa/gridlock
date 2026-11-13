// Strings. The language is the site's own choice, read-only: `localStorage['kidtopia:lang']`
// belongs to kidtopiaplay.com and this game never writes it. Then the browser, then English
// — the same order the site uses, so a page and the game inside it never disagree (§11).
import { en, type Key, type Table } from './en';
import { es } from './es';
import { de } from './de';
import { pt } from './pt';
import { fr } from './fr';
import { no } from './no';
import { ko } from './ko';
import { zh } from './zh';

export type Lang = 'en' | 'es' | 'de' | 'pt' | 'fr' | 'no' | 'ko' | 'zh';
export const TABLES: Record<Lang, Table> = { en, es, de, pt, fr, no, ko, zh };
export const SITE_LANG_KEY = 'kidtopia:lang';

const isLang = (s: string): s is Lang => Object.prototype.hasOwnProperty.call(TABLES, s);

export function detectLang(): Lang {
  try {
    const stored = localStorage.getItem(SITE_LANG_KEY);
    if (stored && isLang(stored)) return stored;
  } catch {
    // A sandboxed frame can throw on storage; the browser's own preference still works.
  }
  const langs = typeof navigator !== 'undefined' ? (navigator.languages ?? [navigator.language]) : [];
  for (const l of langs) {
    const base = (l ?? '').toLowerCase().split('-')[0] ?? '';
    // Norwegian arrives as nb or nn as often as no.
    const mapped = base === 'nb' || base === 'nn' ? 'no' : base;
    if (isLang(mapped)) return mapped;
  }
  return 'en';
}

let current: Lang = 'en';
let blank = false;

export function setLang(lang: Lang): void {
  current = lang;
  if (typeof document !== 'undefined') document.documentElement.lang = lang === 'no' ? 'nb' : lang;
}

export function getLang(): Lang {
  return current;
}

/** `?blank=1`: every string empty. The game must still play (design §11), and smoke proves it. */
export function setBlank(on: boolean): void {
  blank = on;
}

export function t(key: Key, params?: Record<string, string | number>): string {
  if (blank) return '';
  const value = TABLES[current][key] ?? en[key] ?? key;
  if (!params) return value;
  return value.replace(/\{(\w+)\}/g, (_, name: string) => String(params[name] ?? `{${name}}`));
}

export type { Key };
