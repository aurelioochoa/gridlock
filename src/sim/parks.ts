// The six car parks along the promenade (design §5). Bands are cut by `opt`, the shortest
// solution counted in drags; lots.test.ts holds every frozen lot to its band's range.

export type ParkKey = 'harbour' | 'market' | 'lighthouse' | 'pier' | 'dune' | 'sunset';

export interface Park {
  key: ParkKey;
  size: 5 | 6;
  count: number;
  min: number;
  max: number;
  /** Vehicles that never need to move are allowed from Lighthouse Hill on. */
  decoys: boolean;
  /** Flower planters (fixed 1×1) from the Pier on. */
  planters: boolean;
}

export const PARKS: readonly Park[] = [
  { key: 'harbour', size: 5, count: 15, min: 1, max: 6, decoys: false, planters: false },
  { key: 'market', size: 6, count: 25, min: 5, max: 10, decoys: false, planters: false },
  { key: 'lighthouse', size: 6, count: 25, min: 9, max: 15, decoys: true, planters: false },
  { key: 'pier', size: 6, count: 25, min: 14, max: 22, decoys: true, planters: true },
  { key: 'dune', size: 6, count: 25, min: 20, max: 30, decoys: true, planters: true },
  { key: 'sunset', size: 6, count: 15, min: 28, max: 40, decoys: true, planters: true },
];

/** Solves in a car park that open the next one, hinted solves included (design §5). */
export const UNLOCK_SOLVES = 5;

/** Most vehicles of each length in one lot: every piece needs its own roof motif (§9). */
export const MAX_SHORT = 10;
export const MAX_LONG = 6;

/**
 * ★★★ is "the shortest way, by yourself"; a hinted solve keeps up to ★★, plainly (§8, §15.3).
 * Every solve earns at least one star: there is no fail screen.
 */
export function starsFor(moves: number, opt: number, hinted: boolean): 1 | 2 | 3 {
  const base = moves <= opt ? 3 : moves <= opt + Math.max(2, Math.ceil(opt / 2)) ? 2 : 1;
  return hinted ? (Math.min(2, base) as 1 | 2) : base;
}
