// The move history of the lot in progress: what undo walks back, what reset joins, what the
// tyre-track counter counts, and what the save keeps (design §8, §C).
//
// One move is one vehicle slid any distance — one drag, one hold (design §B). So a slide of
// the vehicle that moved last is folded into that move: three slides of one car count 1, and
// a car slid there and back again counts 0 and leaves no entry behind. Reset is an entry of
// its own, so it can itself be undone ("a slip never costs a long lot").

import { type Puzzle, type Pos, isLegal, vanCanExit } from './board';
import { EXIT } from './solver';

export interface MoveEntry {
  v: number;
  from: number;
  to: number;
}
export type Entry = MoveEntry | 'reset';

export function positionOf(p: Puzzle, history: readonly Entry[]): Pos {
  let pos = p.start.slice();
  for (const e of history) {
    if (e === 'reset') pos = p.start.slice();
    else if (e.to !== EXIT) pos[e.v] = e.to;
  }
  return pos;
}

/** Moves since the last reset — the numeral beside the tyre tracks. */
export function moveCount(history: readonly Entry[]): number {
  let n = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i] === 'reset') break;
    n++;
  }
  return n;
}

/** Record a slide, folding it into the previous move when the same vehicle moved last. */
export function pushMove(history: readonly Entry[], v: number, from: number, to: number): Entry[] {
  if (from === to) return history.slice();
  const out = history.slice();
  const last = out[out.length - 1];
  if (last !== undefined && last !== 'reset' && last.v === v && last.to !== EXIT) {
    out.pop();
    if (last.from !== to) out.push({ v, from: last.from, to });
    return out;
  }
  out.push({ v, from, to });
  return out;
}

export function undo(history: readonly Entry[]): Entry[] {
  return history.slice(0, -1);
}

/** Start again. Nothing to reset is a no-op, so pressing ↺ twice leaves one entry to undo. */
export function reset(p: Puzzle, history: readonly Entry[]): Entry[] {
  const pos = positionOf(p, history);
  if (pos.every((o, i) => o === p.start[i])) return history.slice();
  return [...history, 'reset'];
}

export function isSolved(history: readonly Entry[]): boolean {
  const last = history[history.length - 1];
  return last !== undefined && last !== 'reset' && last.to === EXIT;
}

/** The van rolls out: legal only from a position where its column is clear. */
export function pushExit(p: Puzzle, history: readonly Entry[]): Entry[] | null {
  const pos = positionOf(p, history);
  if (!vanCanExit(p, pos)) return null;
  return pushMove(history, 0, pos[0]!, EXIT);
}

// ---- save encoding: [v, from, to] per move, 0 for a reset ------------------------------------

export type Packed = (number | [number, number, number])[];

export function pack(history: readonly Entry[]): Packed {
  return history.map((e) => (e === 'reset' ? 0 : [e.v, e.from, e.to]));
}

/**
 * Rebuild a saved history, replaying every entry against the rules. Anything that is not a
 * legal move from where the board stood is refused whole, so a corrupt save can never put a
 * board into a position the solver did not prove (design §C, §8).
 */
export function unpack(p: Puzzle, raw: unknown): Entry[] | null {
  if (!Array.isArray(raw) || raw.length > 5000) return null;
  const out: Entry[] = [];
  let pos = p.start.slice();
  for (const item of raw) {
    if (item === 0) {
      out.push('reset');
      pos = p.start.slice();
      continue;
    }
    if (!Array.isArray(item) || item.length !== 3) return null;
    const [v, from, to] = item as unknown[];
    if (typeof v !== 'number' || typeof from !== 'number' || typeof to !== 'number') return null;
    if (pos[v] !== from || to === EXIT || !isLegal(p, pos, v, to)) return null;
    out.push({ v, from, to });
    pos[v] = to;
  }
  return out;
}
