// The save: one localStorage key, `gridlock:save`, versioned (design §C).
//
//   { v: 1, lots: { [id]: { stars, best } }, current: { id, history, hinted }, muted,
//     reducedMotion, seen }
//
// Lot ids are board hashes, not list positions, so reordering a band never moves a kid's
// stars onto another board. Parsing falls back field by field: a broken `current` drops only
// the board in progress, never the stars. Storage can throw in a sandboxed frame, so every
// access is wrapped and the game plays on without it.

export const SAVE_KEY = 'gridlock:save';

export interface LotRecord {
  stars: 1 | 2 | 3;
  best: number;
}

export interface Current {
  id: string;
  /** Packed history (see sim/history.ts): replayed against the rules on load. */
  history: unknown[];
  hinted: boolean;
}

export interface Save {
  v: 1;
  lots: Record<string, LotRecord>;
  current: Current | null;
  muted: boolean;
  /** null: follow prefers-reduced-motion. */
  reducedMotion: boolean | null;
  /** One-off teaching marks already shown (the first-lot coach). */
  seen: string[];
}

export function emptySave(): Save {
  return { v: 1, lots: {}, current: null, muted: false, reducedMotion: null, seen: [] };
}

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);

export function parseSave(raw: unknown): Save {
  const s = emptySave();
  if (!isObj(raw) || raw.v !== 1) return s;
  if (isObj(raw.lots)) {
    for (const [id, rec] of Object.entries(raw.lots)) {
      if (!/^[0-9a-z]{1,12}$/.test(id) || !isObj(rec)) continue;
      const stars = rec.stars;
      const best = rec.best;
      if ((stars === 1 || stars === 2 || stars === 3) && typeof best === 'number' && Number.isInteger(best) && best > 0) {
        s.lots[id] = { stars, best };
      }
    }
  }
  const cur = raw.current;
  if (isObj(cur) && typeof cur.id === 'string' && Array.isArray(cur.history)) {
    s.current = { id: cur.id, history: cur.history, hinted: cur.hinted === true };
  }
  if (typeof raw.muted === 'boolean') s.muted = raw.muted;
  if (typeof raw.reducedMotion === 'boolean') s.reducedMotion = raw.reducedMotion;
  if (Array.isArray(raw.seen)) s.seen = raw.seen.filter((x): x is string => typeof x === 'string').slice(0, 50);
  return s;
}

export function loadSave(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Save {
  try {
    const text = storage?.getItem(SAVE_KEY);
    return text ? parseSave(JSON.parse(text)) : emptySave();
  } catch {
    return emptySave();
  }
}

export function writeSave(save: Save, storage: Pick<Storage, 'setItem'> | null = safeStorage()): boolean {
  try {
    storage?.setItem(SAVE_KEY, JSON.stringify(save));
    return !!storage;
  } catch {
    return false;
  }
}

/** Record a solve, keeping the best stars and the fewest moves separately. */
export function recordSolve(save: Save, id: string, stars: 1 | 2 | 3, moves: number): Save {
  const prev = save.lots[id];
  const lots = {
    ...save.lots,
    [id]: { stars: Math.max(prev?.stars ?? 0, stars) as 1 | 2 | 3, best: Math.min(prev?.best ?? Infinity, moves) },
  };
  return { ...save, lots, current: null };
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
