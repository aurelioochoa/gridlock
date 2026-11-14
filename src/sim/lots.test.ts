// Every shipped lot, re-proved from scratch (design §B: "trusts nothing the generator wrote").
//
// The distances here come from a reference solver written in this file, on board strings,
// sharing no code with src/sim/solver.ts — so a bug in the game's solver cannot vouch for
// itself. The game's solver is then held to the reference: same opt, same state count, and a
// hint that always takes the kid exactly one slide closer, from anywhere they can wander.

import { describe, expect, it } from 'vitest';
import data from '../data/lots.json';
import { parseBoard, freeRange, toBoard } from './board';
import { buildGraph, hintFrom, statsOf, EXIT, STATE_LIMIT } from './solver';
import { canonical, lotId } from './canon';
import { componentId } from './component';
import { PARKS, MAX_SHORT, MAX_LONG } from './parks';
import { mulberry32, randInt } from './rng';

interface Lot {
  id: string;
  band: string;
  board: string;
  opt: number;
  movers: number;
  branch: number;
  states: number;
}
const lots = (data as { lots: Lot[] }).lots;

// ---- reference solver: board strings in, distances out -----------------------------------

function refNeighbours(b: string, n: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < b.length; i++) {
    const ch = b[i]!;
    if (ch === '.' || ch === '#' || seen.has(ch)) continue;
    seen.add(ch);
    const cells: number[] = [];
    for (let j = i; j < b.length; j++) if (b[j] === ch) cells.push(j);
    const horiz = cells.length > 1 && cells[1]! - cells[0]! === 1;
    const step = horiz ? 1 : n;
    const first = cells[0]!;
    const last = cells[cells.length - 1]!;
    for (const dir of [-1, 1]) {
      let k = 1;
      for (;;) {
        // The cell the leading end moves into.
        const lead = dir < 0 ? first - k * step : last + k * step;
        if (lead < 0 || lead >= b.length) break;
        if (horiz && Math.floor(lead / n) !== Math.floor(first / n)) break;
        if (b[lead] !== '.') break;
        const arr = b.split('');
        for (const c of cells) arr[c] = '.';
        for (const c of cells) arr[c + dir * k * step] = ch;
        out.push(arr.join(''));
        k++;
      }
    }
  }
  return out;
}

function refCanExit(b: string, n: number): boolean {
  const top = b.indexOf('V');
  for (let r = top - n; r >= 0; r -= n) if (b[r] !== '.') return false;
  return true;
}

function refSolve(board: string): { dist: Map<string, number>; states: number } {
  const n = board.length === 25 ? 5 : 6;
  const all = [board];
  const seen = new Set(all);
  for (let i = 0; i < all.length && all.length <= STATE_LIMIT + 1; i++) {
    for (const nb of refNeighbours(all[i]!, n)) {
      if (!seen.has(nb)) {
        seen.add(nb);
        all.push(nb);
      }
    }
  }
  const dist = new Map<string, number>();
  let frontier = all.filter((b) => refCanExit(b, n));
  for (const b of frontier) dist.set(b, 0);
  for (let d = 1; frontier.length; d++) {
    const next: string[] = [];
    for (const b of frontier) {
      for (const nb of refNeighbours(b, n)) {
        if (!dist.has(nb)) {
          dist.set(nb, d);
          next.push(nb);
        }
      }
    }
    frontier = next;
  }
  return { dist, states: all.length };
}

// ---- the file as a whole ----------------------------------------------------------------

describe('lots.json', () => {
  it('has its header', () => {
    const d = data as { generatorVersion: unknown; seed: unknown; generatedAt: unknown };
    expect(d.generatorVersion).toBeTypeOf('number');
    expect(d.seed).toBeTypeOf('number');
    expect(d.generatedAt).toMatch(/^\d{4}-\d\d-\d\d$/);
  });

  it('holds 130 lots, each car park in order with its count', () => {
    expect(lots.length).toBe(130);
    let i = 0;
    for (const park of PARKS) {
      for (let k = 0; k < park.count; k++) expect(lots[i++]!.band).toBe(park.key);
    }
  });

  it('gives every lot a unique id that is its board hash', () => {
    expect(new Set(lots.map((l) => l.id)).size).toBe(lots.length);
    for (const l of lots) expect(l.id).toBe(lotId(l.board));
  });

  it('has no mirror twins and no two lots from one component', () => {
    expect(new Set(lots.map((l) => canonical(l.board))).size).toBe(lots.length);
    const comps = lots.map((l) => {
      const p = parseBoard(l.board);
      return componentId(buildGraph(p, p.start)!);
    });
    expect(new Set(comps).size).toBe(lots.length);
  });

  it('climbs inside each car park (after the three hand-placed teaching boards)', () => {
    for (const park of PARKS) {
      const band = lots.filter((l, i) => l.band === park.key && i >= 3);
      for (let k = 1; k < band.length; k++) expect(band[k]!.opt).toBeGreaterThanOrEqual(band[k - 1]!.opt);
    }
  });

  it('opens with the three hand-placed teaching boards', () => {
    expect(lots.slice(0, 3).map((l) => [l.opt, l.movers])).toEqual([[2, 2], [2, 2], [3, 3]]);
  });
});

// ---- every lot, one by one --------------------------------------------------------------

describe.each(lots.map((l, i) => [i + 1, l] as const))('lot %i', (_n, lot) => {
  const park = PARKS.find((p) => p.key === lot.band)!;

  it('parses and fits its car park', () => {
    const p = parseBoard(lot.board); // throws on size, lengths, van, overlaps
    expect(p.size).toBe(park.size);
    const shorts = p.vehicles.filter((v, i) => i > 0 && v.len === 2).length;
    expect(shorts).toBeLessThanOrEqual(MAX_SHORT);
    expect(p.vehicles.length - 1 - shorts).toBeLessThanOrEqual(MAX_LONG);
    if (!park.planters) expect(p.walls).toEqual([]);
    // In bounds and no overlaps: the board drawn back from the parse is the board.
    expect(toBoard(p, p.start)).toBe(lot.board);
  });

  it('re-solves to its stored numbers, inside its band', () => {
    const ref = refSolve(lot.board);
    const d0 = ref.dist.get(lot.board);
    expect(d0, 'solvable').toBeDefined();
    expect(d0!, 'the van cannot already leave').toBeGreaterThan(0);
    expect(ref.states).toBeLessThanOrEqual(STATE_LIMIT);
    expect(ref.states).toBe(lot.states);
    expect(d0! + 1).toBe(lot.opt);
    expect(lot.opt).toBeGreaterThanOrEqual(park.min);
    expect(lot.opt).toBeLessThanOrEqual(park.max);

    const p = parseBoard(lot.board);
    const g = buildGraph(p, p.start)!;
    const st = statsOf(g, p.start)!;
    expect(st).toEqual({ opt: lot.opt, movers: lot.movers, branch: lot.branch, states: lot.states });
    // Before Lighthouse Hill every vehicle is part of the solution: no decoys.
    if (!park.decoys) expect(lot.movers).toBe(p.vehicles.length);
  });

  it('hints one slide closer, from anywhere a kid can wander', () => {
    const p = parseBoard(lot.board);
    const g = buildGraph(p, p.start)!;
    const ref = refSolve(lot.board).dist;
    const rng = mulberry32(lot.id.split('').reduce((a, c) => a * 31 + c.charCodeAt(0), 7) >>> 0);
    for (let walk = 0; walk < 20; walk++) {
      const pos = p.start.slice();
      const steps = randInt(rng, 0, 40);
      for (let s = 0; s <= steps; s++) {
        const here = ref.get(toBoard(p, pos))!;
        const m = hintFrom(g, pos)!;
        expect(m).not.toBeNull();
        if (here === 0) {
          expect(m).toEqual({ v: 0, to: EXIT });
        } else {
          const next = pos.slice();
          next[m.v] = m.to;
          expect(ref.get(toBoard(p, next))).toBe(here - 1);
        }
        // Wander: any legal slide of any vehicle.
        const moves: [number, number][] = [];
        for (let i = 0; i < p.vehicles.length; i++) {
          const [lo, hi] = freeRange(p, pos, i);
          for (let o = lo; o <= hi; o++) if (o !== pos[i]) moves.push([i, o]);
        }
        const [v, o] = moves[randInt(rng, 0, moves.length - 1)]!;
        pos[v] = o;
      }
    }
  });
});
