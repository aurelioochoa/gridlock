// The lot generator (design §B). Dev-only: run by hand with `npm run lots`, never by the build.
//
//   npm run lots                 # writes src/data/lots.json from scratch (seed below)
//   npm run lots -- --probe 6 12 # timing + depth histogram for random 6×6 boards, 12 vehicles
//
// (1) A seeded random board for the band. (2) BFS its reachable component; reject it over
//     50,000 positions or with no exit. (3) BFS backwards from every exit position, so each
//     position knows its distance: one random board yields every difficulty it holds.
// (4) Take a start at the band's target distance, never one where the van can already leave,
//     and before Lighthouse Hill none with decoys (vehicles the solution never moves are
//     pruned away, and the lot kept only if it stays in band). (5) Canonicalise, dedupe, at
//     most one lot per component.
//
// The deep bands (Dune Campsite, Sunset Fair) are rare among random boards, so after the
// random draw the generator also hill-climbs: it mutates a board (add, remove or shift one
// piece) and keeps the mutation when the component's hardest start gets no easier. Still
// seeded, still verified the same way.
//
// lots.test.ts trusts none of this: it re-parses and re-solves every lot it writes.

import { writeFileSync } from 'node:fs';
import { parseBoard, toBoard, cellsAt, type Puzzle, type Pos } from '../src/sim/board';
import { buildGraph, statsOf, solutionFrom, stateAt, STATE_LIMIT, EXIT, type Graph } from '../src/sim/solver';
import { canonical, lotId } from '../src/sim/canon';
import { componentId } from '../src/sim/component';
import { mulberry32, randInt, type Rng } from '../src/sim/rng';
import { PARKS, MAX_SHORT, MAX_LONG, type Park } from '../src/sim/parks';

export const GENERATOR_VERSION = 1;
export const SEED = 20261113;

/** Harbour 1–3: hand-placed teaching boards (design §3, §B), verified like the rest. */
export const TEACHING = [
  // One car across the van's path; it can go either way.
  '.....' + '.aa..' + '..V..' + '..V..' + '.....',
  // A car that can only go one way: right is the wall, so it must go left.
  '.....' + '...aa' + '...V.' + '...V.' + '.....',
  // A chain: the car is pinned by a camper van, which must back away first.
  '..b..' + 'aab..' + '.Vb..' + '.V...' + '.....',
];

interface Lot {
  id: string;
  band: string;
  board: string;
  opt: number;
  movers: number;
  branch: number;
  states: number;
}

const ORDER = 'abcdefghijklmno';

// ---- random boards -----------------------------------------------------------------------

function vehicleRange(park: Park): [number, number] {
  // Measured (scripts/dev/depth.ts): on 6×6, deep components come from crowded boards —
  // 13–15 pieces give the most hard starts per second, because their components are small.
  switch (park.key) {
    case 'harbour': return [2, 5];
    case 'market': return [4, 10];
    case 'lighthouse': return [8, 13];
    case 'pier': return [11, 15];
    case 'dune': return [12, 15];
    case 'sunset': return [12, 15];
  }
}

/** Boards tried per car park. Counted, not timed, so the same seed writes the same file. */
function budgetFor(park: Park): number {
  switch (park.key) {
    case 'harbour': return 20_000;
    case 'market': return 20_000;
    case 'lighthouse': return 40_000;
    case 'pier': return 80_000;
    case 'dune': return 250_000;
    case 'sunset': return 1_200_000;
  }
}

/** Place pieces at random into a grid; returns a board string or null. */
function randomBoard(rng: Rng, park: Park): string | null {
  const n = park.size;
  const cells = new Array<string>(n * n).fill('.');
  const vanCol = randInt(rng, 0, n - 1);
  const vanRow = randInt(rng, 1, n - 2);
  cells[vanRow * n + vanCol] = 'V';
  cells[(vanRow + 1) * n + vanCol] = 'V';
  if (park.planters) {
    const walls = randInt(rng, 0, 3);
    for (let w = 0; w < walls; w++) {
      const c = randInt(rng, 0, n * n - 1);
      // Never in the van's column above it: that is a lot with no exit.
      if (cells[c] === '.' && !(c % n === vanCol && Math.floor(c / n) < vanRow)) cells[c] = '#';
    }
  }
  const [lo, hi] = vehicleRange(park);
  const want = randInt(rng, lo, hi);
  let placed = 0;
  let shorts = 0;
  let longs = 0;
  for (let attempt = 0; attempt < 200 && placed < want; attempt++) {
    const len = rng() < 0.72 ? 2 : 3;
    if (len === 2 ? shorts >= MAX_SHORT : longs >= MAX_LONG) continue;
    const horiz = rng() < 0.5;
    const lane = randInt(rng, 0, n - 1);
    const off = randInt(rng, 0, n - len);
    // An upright piece in the van's own column can never leave it.
    if (!horiz && lane === vanCol) continue;
    const at: number[] = [];
    for (let k = 0; k < len; k++) at.push(horiz ? lane * n + off + k : (off + k) * n + lane);
    if (at.some((c) => cells[c] !== '.')) continue;
    const letter = ORDER[placed]!;
    for (const c of at) cells[c] = letter;
    placed++;
    if (len === 2) shorts++;
    else longs++;
  }
  return placed >= lo ? cells.join('') : null;
}

/** One mutation for the hill climb: drop a piece, add a piece, or shift one along its lane. */
function mutate(rng: Rng, park: Park, board: string): string | null {
  const p = parseBoard(board);
  const n = p.size;
  const kind = rng();
  if (kind < 0.25 && p.vehicles.length > 3) {
    const drop = randInt(rng, 1, p.vehicles.length - 1);
    const letter = p.vehicles[drop]!.letter;
    return relabelGaps(board.split(letter).join('.'));
  }
  if (kind < 0.6) {
    const cells = board.split('');
    const shorts = p.vehicles.filter((v, i) => i > 0 && v.len === 2).length;
    const longs = p.vehicles.length - 1 - shorts;
    if (p.vehicles.length - 1 >= ORDER.length) return null;
    const len = rng() < 0.7 ? 2 : 3;
    if (len === 2 ? shorts >= MAX_SHORT : longs >= MAX_LONG) return null;
    const horiz = rng() < 0.5;
    const lane = randInt(rng, 0, n - 1);
    const off = randInt(rng, 0, n - len);
    if (!horiz && lane === p.vehicles[0]!.lane) return null;
    const at: number[] = [];
    for (let k = 0; k < len; k++) at.push(horiz ? lane * n + off + k : (off + k) * n + lane);
    if (at.some((c) => cells[c] !== '.')) return null;
    const used = new Set(p.vehicles.map((v) => v.letter));
    const letter = [...ORDER].find((l) => !used.has(l))!;
    for (const c of at) cells[c] = letter;
    return cells.join('');
  }
  if (kind < 0.7 && park.planters) {
    const cells = board.split('');
    const walls = cells.flatMap((c, i) => (c === '#' ? [i] : []));
    if (walls.length && rng() < 0.5) {
      cells[walls[randInt(rng, 0, walls.length - 1)]!] = '.';
    } else if (walls.length < 4) {
      const c = randInt(rng, 0, n * n - 1);
      const vanCol = p.vehicles[0]!.lane;
      if (cells[c] !== '.' || (c % n === vanCol && Math.floor(c / n) < p.start[0]!)) return null;
      cells[c] = '#';
    }
    return cells.join('');
  }
  // Shift a piece anywhere it fits in its lane (ignoring reachability: that is the point).
  const i = randInt(rng, 1, p.vehicles.length - 1);
  const v = p.vehicles[i]!;
  const cells = board.split('');
  for (const c of cellsAt(p, i, p.start[i]!)) cells[c] = '.';
  const off = randInt(rng, 0, n - v.len);
  const at = cellsAt(p, i, off);
  if (at.some((c) => cells[c] !== '.')) return null;
  for (const c of at) cells[c] = v.letter;
  return cells.join('');
}

/** Keep letters dense after a piece is removed, so parseBoard's order stays a, b, c… */
function relabelGaps(board: string): string {
  const map = new Map<string, string>();
  let next = 0;
  return [...board]
    .map((ch) => {
      if (ch === '.' || ch === '#' || ch === 'V') return ch;
      if (!map.has(ch)) map.set(ch, ORDER[next++]!);
      return map.get(ch)!;
    })
    .join('');
}

// ---- picking a start ------------------------------------------------------------------------

function maxOpt(g: Graph): number {
  let m = -1;
  for (let s = 0; s < g.count; s++) if (g.dist[s]! > m) m = g.dist[s]!;
  return m + 1;
}

/** All start positions in the component whose shortest solution is exactly `opt`. */
function startsAt(g: Graph, opt: number): number[] {
  const out: number[] = [];
  for (let s = 0; s < g.count; s++) if (g.dist[s] === opt - 1) out.push(s);
  return out;
}

/** Remove vehicles the shortest solution never touches (no decoys before Lighthouse Hill). */
function pruneDecoys(p: Puzzle, start: Pos): string | null {
  let board = toBoard(p, start);
  for (let round = 0; round < 6; round++) {
    const q = parseBoard(board);
    const g = buildGraph(q, q.start);
    if (!g) return null;
    const sol = solutionFrom(g, q.start);
    if (!sol) return null;
    const moved = new Set(sol.map((m) => m.v));
    const idle = q.vehicles.flatMap((v, i) => (moved.has(i) ? [] : [v.letter]));
    if (!idle.length) return board;
    for (const l of idle) board = board.split(l).join('.');
    board = relabelGaps(board);
  }
  return null;
}

interface Candidate {
  lot: Lot;
  comp: string;
}

function makeLot(park: Park, board: string): Candidate | null {
  const canon = canonical(board);
  const p = parseBoard(canon);
  const g = buildGraph(p, p.start);
  if (!g) return null;
  const st = statsOf(g, p.start);
  if (!st || st.opt < park.min || st.opt > park.max) return null;
  if (g.dist[0] === 0) return null;
  const shorts = p.vehicles.filter((v, i) => i > 0 && v.len === 2).length;
  if (shorts > MAX_SHORT || p.vehicles.length - 1 - shorts > MAX_LONG) return null;
  return {
    lot: { id: lotId(canon), band: park.key, board: canon, ...st },
    comp: componentId(g),
  };
}

/** Even quotas over the band's opt range, so a car park climbs rather than sitting in a lump. */
function quotas(park: Park, count: number): Map<number, number> {
  const lo = Math.max(park.min, 2);
  const values: number[] = [];
  for (let o = lo; o <= park.max; o++) values.push(o);
  const q = new Map<number, number>();
  for (let k = 0; k < count; k++) {
    const o = values[Math.floor((k * values.length) / count)]!;
    q.set(o, (q.get(o) ?? 0) + 1);
  }
  return q;
}

function generatePark(park: Park, count: number, rng: Rng, seen: Set<string>, comps: Set<string>): Lot[] {
  const want = quotas(park, count);
  const got: Lot[] = [];
  const budget = budgetFor(park);
  let tries = 0;
  // Early on only an opt still under its quota is taken; after this, anything in band.
  const strictUntil = Math.floor(budget * 0.6);
  const strict = () => tries < strictUntil;
  // Deep bands hill-climb from any board that is already fairly deep.
  const climbFrom = park.min >= 20 ? park.min - 6 : Infinity;
  let current: string | null = null;
  let currentTop = 0;
  let steps = 0;

  // Deep bands have no quotas: a component's start is drawn uniformly from the band's opts it
  // can reach, which spreads them without stalling on an opt no board in reach offers.
  const free = park.min >= 20;
  const consider = (g: Graph): boolean => {
    const top = Math.min(maxOpt(g), park.max);
    let pool: number[];
    if (free) {
      pool = [randInt(rng, park.min, top)];
    } else {
      const targets = [...want.entries()].filter(([o, k]) => k > 0 && o <= top && o >= park.min).map(([o]) => o);
      pool = targets.length ? targets : strict() ? [] : [top].filter((o) => o >= park.min);
    }
    for (const target of pool.sort((a, b) => b - a)) {
      const starts = startsAt(g, target);
      if (!starts.length) continue;
      const s = starts[randInt(rng, 0, starts.length - 1)]!;
      let board: string | null = toBoard(g.p, stateAt(g, s));
      if (!park.decoys) board = pruneDecoys(parseBoard(board), parseBoard(board).start);
      if (!board) continue;
      const c = makeLot(park, board);
      if (!c || seen.has(c.lot.board) || comps.has(c.comp)) continue;
      const left = want.get(c.lot.opt) ?? 0;
      if (!free && left <= 0 && strict()) continue;
      want.set(c.lot.opt, left - 1);
      seen.add(c.lot.board);
      comps.add(c.comp);
      got.push(c.lot);
      return true;
    }
    return false;
  };

  while (got.length < count && tries < budget) {
    tries++;
    if (tries % 20_000 === 0) console.log(`    ${park.key}: ${got.length}/${count} after ${tries} boards (climbing at ${currentTop})`);
    const climbing = current !== null;
    const board = climbing ? mutate(rng, park, current!) : randomBoard(rng, park);
    if (!board) continue;
    let p: Puzzle;
    try {
      p = parseBoard(board);
    } catch {
      continue;
    }
    // A climb that drifts towards an empty board explodes in size and crawls; cap it.
    const g = buildGraph(p, p.start, climbing ? 12_000 : STATE_LIMIT);
    if (!g) continue;
    const top = maxOpt(g);
    if (climbing) {
      steps++;
      if (top >= currentTop) {
        current = board;
        currentTop = top;
      }
      if (steps > 600) current = null;
    } else if (top >= climbFrom) {
      current = board;
      currentTop = top;
      steps = 0;
    }
    if (top >= park.min) consider(g);
  }
  console.log(`  ${park.key}: ${got.length}/${count} lots after ${tries} boards`);
  if (got.length < count) throw new Error(`${park.key}: only ${got.length} of ${count} lots — raise the budget`);
  return got;
}

function sortBand(a: Lot, b: Lot): number {
  return a.opt - b.opt || a.movers - b.movers || a.branch - b.branch || (a.id < b.id ? -1 : 1);
}

function probe(args: string[]): void {
  const size = Number(args[0] ?? 6) as 5 | 6;
  const vehicles = Number(args[1] ?? 12);
  const park: Park = { key: 'dune', size, count: 0, min: 0, max: 99, decoys: true, planters: size === 6 };
  const rng = mulberry32(1);
  const hist = new Map<number, number>();
  const t0 = Date.now();
  let n = 0;
  let total = 0;
  while (Date.now() - t0 < 20_000) {
    const board = randomBoard(rng, { ...park, key: 'sunset' });
    if (!board) continue;
    const p = parseBoard(board);
    if (p.vehicles.length - 1 < vehicles - 2) continue;
    const g = buildGraph(p, p.start);
    n++;
    if (!g) continue;
    total += g.count;
    const m = maxOpt(g);
    const b = Math.floor(m / 5) * 5;
    hist.set(b, (hist.get(b) ?? 0) + 1);
  }
  console.log(`${n} boards in 20 s, mean ${Math.round(total / n)} states`);
  console.log([...hist.entries()].sort((a, b) => a[0] - b[0]));
}

export default async function main(args: string[]): Promise<void> {
  if (args[0] === '--probe') return probe(args.slice(1));
  const only = args[0] === '--only' ? args[1] : null;
  const rng = mulberry32(SEED);
  const seen = new Set<string>();
  const comps = new Set<string>();
  const lots: Lot[] = [];

  const harbour = PARKS[0]!;
  const teaching: Lot[] = [];
  for (const board of TEACHING) {
    // Teaching boards are kept exactly as drawn (not canonicalised into their mirror), since
    // design §3 describes them square by square.
    const p = parseBoard(board);
    const g = buildGraph(p, p.start)!;
    const st = statsOf(g, p.start)!;
    seen.add(canonical(board));
    comps.add(componentId(g));
    teaching.push({ id: lotId(board), band: 'harbour', board, ...st });
  }
  console.log('generating…');
  for (const park of PARKS) {
    if (only && park.key !== only) continue;
    const count = park.key === 'harbour' ? park.count - teaching.length : park.count;
    const band = generatePark(park, count, rng, seen, comps).sort(sortBand);
    lots.push(...(park.key === 'harbour' ? [...teaching, ...band] : band));
  }
  const lines = lots.map((l) => '    ' + JSON.stringify(l));
  const out =
    '{\n' +
    `  "generatorVersion": ${GENERATOR_VERSION},\n` +
    `  "seed": ${SEED},\n` +
    `  "generatedAt": "${new Date().toISOString().slice(0, 10)}",\n` +
    '  "lots": [\n' +
    lines.join(',\n') +
    '\n  ]\n}\n';
  if (only) {
    console.log(lines.join('\n'));
    return;
  }
  writeFileSync('src/data/lots.json', out);
  console.log(`wrote ${lots.length} lots to src/data/lots.json`);
  void EXIT;
  void STATE_LIMIT;
}
