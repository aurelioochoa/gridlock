import { describe, expect, it } from 'vitest';
import { parseSave, emptySave, loadSave, writeSave, recordSolve, SAVE_KEY, type Save } from './save';

class Mem {
  data = new Map<string, string>();
  getItem(k: string) { return this.data.get(k) ?? null; }
  setItem(k: string, v: string) { this.data.set(k, v); }
}

describe('save', () => {
  it('round-trips', () => {
    const m = new Mem();
    const s = { ...emptySave(), lots: { abc1234: { stars: 3 as const, best: 4 } }, current: { id: 'abc1234', history: [[1, 0, 2], 0], hinted: true }, muted: true, reducedMotion: false, seen: ['coach'] };
    expect(writeSave(s, m)).toBe(true);
    expect(m.data.has(SAVE_KEY)).toBe(true);
    expect(loadSave(m)).toEqual(s);
  });

  it('falls back field by field', () => {
    const s = parseSave({ v: 1, lots: { good123: { stars: 2, best: 7 }, bad: { stars: 9, best: 1 }, 'x y': { stars: 1, best: 1 } }, current: 'garbage', muted: 'yes', reducedMotion: true, seen: ['a', 3] });
    expect(s.lots).toEqual({ good123: { stars: 2, best: 7 } });
    expect(s.current).toBeNull();
    expect(s.muted).toBe(false);
    expect(s.reducedMotion).toBe(true);
    expect(s.seen).toEqual(['a']);
  });

  it('ignores another version, junk JSON and storage that throws', () => {
    expect(parseSave({ v: 2, muted: true })).toEqual(emptySave());
    expect(loadSave({ getItem: () => '{not json' })).toEqual(emptySave());
    expect(loadSave({ getItem: () => { throw new Error('sandboxed'); } })).toEqual(emptySave());
    expect(writeSave(emptySave(), { setItem: () => { throw new Error('quota'); } })).toBe(false);
  });

  it('keeps the best stars and the fewest moves, and clears the board in progress', () => {
    let s: Save = { ...emptySave(), current: { id: 'a', history: [], hinted: false } };
    s = recordSolve(s, 'lot0001', 2, 9);
    s = recordSolve(s, 'lot0001', 3, 12);
    s = recordSolve(s, 'lot0001', 1, 7);
    expect(s.lots.lot0001).toEqual({ stars: 3, best: 7 });
    expect(s.current).toBeNull();
  });
});
