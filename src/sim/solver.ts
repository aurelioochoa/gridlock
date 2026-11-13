// The solver: one breadth-first search over every position reachable from a start.
//
// A vehicle never leaves its lane, so a position is one offset per vehicle, packed into a
// number (3 bits each — 16 vehicles fit in 48 bits, well inside a double's 53). A move is one
// vehicle slid to any free offset: one drag, one hold (design §B).
//
// Every slide can be slid back, so the move graph is undirected, and "distance to the exit"
// is a single multi-source BFS from every position where the van's column is clear. That one
// table answers the shortest solution, the hint from wherever the kid has got to, and the
// generator's question "how hard is the hardest start in here?" (design §8, §B).

import { type Puzzle, type Pos, VAN, EMPTY, WALL, vanCanExit, occupancy } from './board';

/** `to` for the van rolling out through the gap. */
export const EXIT = -1;
/** Design §B: every lot has at most this many reachable positions, test-asserted. */
export const STATE_LIMIT = 50_000;

export interface Move {
  v: number;
  to: number;
}

export interface Graph {
  p: Puzzle;
  count: number;
  /** count × vehicles offsets, BFS order from the start (index 0 is the start). */
  states: Uint8Array;
  index: Map<number, number>;
  adjStart: Int32Array;
  adj: Int32Array;
  /** Slides to a position where the van can leave; −1 if no such position is reachable. */
  dist: Int32Array;
}

export function keyOf(pos: ArrayLike<number>): number {
  let k = 0;
  let mul = 1;
  for (let i = 0; i < pos.length; i++) {
    k += pos[i]! * mul;
    mul *= 8;
  }
  return k;
}

/**
 * Explore the whole component around `start`. Returns null if it has more than `limit`
 * positions — the generator rejects those, and no shipped lot has one (lots.test.ts).
 */
export function buildGraph(p: Puzzle, start: Pos, limit = STATE_LIMIT): Graph | null {
  const V = p.vehicles.length;
  const n = p.size;
  const lanes = p.vehicles.map((v) => v.lane);
  const lens = p.vehicles.map((v) => v.len);
  const horiz = p.vehicles.map((v) => v.horiz);
  const base = new Int8Array(n * n).fill(EMPTY);
  for (const w of p.walls) base[w] = WALL;

  let cap = 1024;
  let states = new Uint8Array(cap * V);
  const index = new Map<number, number>();
  const adjStartList: number[] = [0];
  const adjList: number[] = [];
  let count = 0;

  const push = (pos: ArrayLike<number>, key: number): number | null => {
    if (count >= limit) return null;
    if (count >= cap) {
      cap *= 2;
      const grown = new Uint8Array(cap * V);
      grown.set(states);
      states = grown;
    }
    states.set(pos as ArrayLike<number>, count * V);
    index.set(key, count);
    return count++;
  };

  push(start, keyOf(start));
  const occ = new Int8Array(n * n);
  const cur = new Uint8Array(V);
  for (let s = 0; s < count; s++) {
    cur.set(states.subarray(s * V, s * V + V));
    occ.set(base);
    for (let i = 0; i < V; i++) {
      const o = cur[i]!;
      for (let k = 0; k < lens[i]!; k++) occ[horiz[i] ? lanes[i]! * n + o + k : (o + k) * n + lanes[i]!] = i;
    }
    let mul = 1;
    let key = 0;
    for (let i = 0; i < V; i++) {
      key += cur[i]! * mul;
      mul *= 8;
    }
    mul = 1;
    for (let i = 0; i < V; i++) {
      const o = cur[i]!;
      const at = horiz[i] ? (x: number) => lanes[i]! * n + x : (x: number) => x * n + lanes[i]!;
      for (let dir = -1; dir <= 1; dir += 2) {
        let off = o;
        for (;;) {
          const probe = dir < 0 ? off - 1 : off + lens[i]!;
          if (probe < 0 || probe >= n || occ[at(probe)] !== EMPTY) break;
          off += dir;
          const nk = key + (off - o) * mul;
          let ni = index.get(nk);
          if (ni === undefined) {
            cur[i] = off;
            const added = push(cur, nk);
            cur[i] = o;
            if (added === null) return null;
            ni = added;
          }
          adjList.push(ni);
        }
      }
      mul *= 8;
    }
    adjStartList.push(adjList.length);
  }

  // Distance to the exit: multi-source BFS from every position where the van's path is clear.
  const dist = new Int32Array(count).fill(-1);
  const adjStart = Int32Array.from(adjStartList);
  const adj = Int32Array.from(adjList);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;
  const pos: number[] = new Array<number>(V);
  for (let s = 0; s < count; s++) {
    for (let i = 0; i < V; i++) pos[i] = states[s * V + i]!;
    if (vanCanExit(p, pos)) {
      dist[s] = 0;
      queue[tail++] = s;
    }
  }
  while (head < tail) {
    const s = queue[head++]!;
    for (let e = adjStart[s]!; e < adjStart[s + 1]!; e++) {
      const t = adj[e]!;
      if (dist[t] === -1) {
        dist[t] = dist[s]! + 1;
        queue[tail++] = t;
      }
    }
  }
  return { p, count, states: states.slice(0, count * V), index, adjStart, adj, dist };
}

export function stateAt(g: Graph, s: number): Pos {
  const V = g.p.vehicles.length;
  return Array.from(g.states.subarray(s * V, s * V + V));
}

export function indexOf(g: Graph, pos: Pos): number {
  return g.index.get(keyOf(pos)) ?? -1;
}

/** Slides from `pos` to a position where the van can leave; −1 if unreachable or unknown. */
export function distanceOf(g: Graph, pos: Pos): number {
  const s = indexOf(g, pos);
  return s < 0 ? -1 : g.dist[s]!;
}

/** Shortest solution length counted the way the kid counts it: the slides plus the van's
 *  own roll out (design §B — one move is one drag, and driving out is a drag too). */
export function optOf(g: Graph, pos: Pos): number {
  const d = distanceOf(g, pos);
  return d < 0 ? -1 : d + 1;
}

/**
 * A good next move from wherever the kid has got to (design §8): one that brings the van one
 * slide closer to a clear path, or the van rolling out once it has one. Deterministic.
 */
export function hintFrom(g: Graph, pos: Pos): Move | null {
  const s = indexOf(g, pos);
  if (s < 0) return null;
  const d = g.dist[s]!;
  if (d < 0) return null;
  if (d === 0) return { v: VAN, to: EXIT };
  const V = g.p.vehicles.length;
  for (let e = g.adjStart[s]!; e < g.adjStart[s + 1]!; e++) {
    const t = g.adj[e]!;
    if (g.dist[t] === d - 1) {
      for (let i = 0; i < V; i++) {
        const to = g.states[t * V + i]!;
        if (to !== pos[i]) return { v: i, to };
      }
    }
  }
  return null;
}

/** The hint followed to the end: a shortest solution, ending with the van's roll out. */
export function solutionFrom(g: Graph, pos: Pos): Move[] | null {
  const out: Move[] = [];
  const cur = pos.slice();
  for (;;) {
    const m = hintFrom(g, cur);
    if (!m) return null;
    out.push(m);
    if (m.to === EXIT) return out;
    cur[m.v] = m.to;
  }
}

/** Legal slides from a position — the `branch` statistic's unit. */
export function degreeOf(g: Graph, pos: Pos): number {
  const s = indexOf(g, pos);
  return s < 0 ? 0 : g.adjStart[s + 1]! - g.adjStart[s]!;
}

export interface LotStats {
  opt: number;
  movers: number;
  branch: number;
  states: number;
}

/** The difficulty numbers stored per lot (design §B). */
export function statsOf(g: Graph, start: Pos): LotStats | null {
  const sol = solutionFrom(g, start);
  if (!sol) return null;
  const cur = start.slice();
  let deg = 0;
  let steps = 0;
  for (const m of sol) {
    deg += degreeOf(g, cur);
    steps++;
    if (m.to !== EXIT) cur[m.v] = m.to;
  }
  return {
    opt: sol.length,
    movers: new Set(sol.map((m) => m.v)).size,
    branch: Math.round((deg / steps) * 100) / 100,
    states: g.count,
  };
}

/** Convenience used by the game: has the start a clear path already? (never true of a lot) */
export function startIsOpen(p: Puzzle): boolean {
  return vanCanExit(p, p.start, occupancy(p, p.start));
}
