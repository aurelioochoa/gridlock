// The board: parsing a lot string, and the rules of a slide.
//
// Pure — no DOM, no randomness. The game, the generator and the tests all read the same
// rules from here, so a lot the generator proved is a lot the game plays (design §12).
//
// A board string is 25 or 36 chars in reading order (design §B):
//   `.` empty, `V` the van, `a`–`o` one letter per vehicle, `#` a planter.
// A vehicle's cells give its length and direction. The exit is the top of the van's column.

export interface Vehicle {
  /** The letter on the board string, `V` for the van. */
  letter: string;
  len: 2 | 3;
  horiz: boolean;
  /** The row a horizontal vehicle lives on, or the column of a vertical one. Never changes. */
  lane: number;
}

export interface Puzzle {
  size: 5 | 6;
  /** vehicles[0] is always the van; the rest follow in letter order. */
  vehicles: Vehicle[];
  /** Cell indices of the planters (fixed 1×1). */
  walls: number[];
  /** Start offset of each vehicle along its lane: the column of a horizontal vehicle's
   *  left end, the row of a vertical vehicle's top end. */
  start: number[];
}

/** A position is one offset per vehicle, in Puzzle.vehicles order. */
export type Pos = number[];

export const VAN = 0;
export const EMPTY = -1;
export const WALL = -2;

export class BoardError extends Error {}

export function parseBoard(board: string): Puzzle {
  const size = board.length === 25 ? 5 : board.length === 36 ? 6 : 0;
  if (!size) throw new BoardError(`board must be 25 or 36 cells, got ${board.length}`);
  const cells = new Map<string, number[]>();
  const walls: number[] = [];
  for (let i = 0; i < board.length; i++) {
    const ch = board[i]!;
    if (ch === '.') continue;
    if (ch === '#') {
      walls.push(i);
      continue;
    }
    if (ch !== 'V' && !(ch >= 'a' && ch <= 'o')) throw new BoardError(`unknown cell "${ch}" at ${i}`);
    const list = cells.get(ch) ?? [];
    list.push(i);
    cells.set(ch, list);
  }
  if (!cells.has('V')) throw new BoardError('no van');
  const letters = [...cells.keys()].sort((a, b) => (a === 'V' ? -1 : b === 'V' ? 1 : a < b ? -1 : 1));
  const vehicles: Vehicle[] = [];
  const start: number[] = [];
  for (const letter of letters) {
    const list = cells.get(letter)!;
    const len = list.length;
    if (len !== 2 && len !== 3) throw new BoardError(`vehicle ${letter} has length ${len}`);
    const rows = list.map((c) => Math.floor(c / size));
    const cols = list.map((c) => c % size);
    const sameRow = rows.every((r) => r === rows[0]);
    const sameCol = cols.every((c) => c === cols[0]);
    let horiz: boolean;
    if (sameRow && !sameCol) {
      horiz = true;
      for (let k = 1; k < len; k++) if (cols[k] !== cols[0]! + k) throw new BoardError(`vehicle ${letter} is not contiguous`);
    } else if (sameCol && !sameRow) {
      horiz = false;
      for (let k = 1; k < len; k++) if (rows[k] !== rows[0]! + k) throw new BoardError(`vehicle ${letter} is not contiguous`);
    } else {
      throw new BoardError(`vehicle ${letter} is not a straight line`);
    }
    if (letter === 'V' && (horiz || len !== 2)) throw new BoardError('the van must be upright and 2 long');
    vehicles.push({ letter, len: len as 2 | 3, horiz, lane: horiz ? rows[0]! : cols[0]! });
    start.push(horiz ? cols[0]! : rows[0]!);
  }
  return { size, vehicles, walls, start };
}

/** Cells covered by vehicle `i` at offset `off`. */
export function cellsAt(p: Puzzle, i: number, off: number): number[] {
  const v = p.vehicles[i]!;
  const out: number[] = [];
  for (let k = 0; k < v.len; k++) {
    out.push(v.horiz ? v.lane * p.size + off + k : (off + k) * p.size + v.lane);
  }
  return out;
}

/** Who sits where: vehicle index, EMPTY or WALL per cell. */
export function occupancy(p: Puzzle, pos: Pos): Int8Array {
  const occ = new Int8Array(p.size * p.size).fill(EMPTY);
  for (const w of p.walls) occ[w] = WALL;
  for (let i = 0; i < p.vehicles.length; i++) {
    for (const c of cellsAt(p, i, pos[i]!)) occ[c] = i;
  }
  return occ;
}

/** How far vehicle `i` can slide each way from where it is: [lowest offset, highest offset]. */
export function freeRange(p: Puzzle, pos: Pos, i: number, occ = occupancy(p, pos)): [number, number] {
  const v = p.vehicles[i]!;
  const n = p.size;
  const at = (o: number) => (v.horiz ? v.lane * n + o : o * n + v.lane);
  const cur = pos[i]!;
  let lo = cur;
  while (lo - 1 >= 0 && occ[at(lo - 1)] === EMPTY) lo--;
  let hi = cur;
  while (hi + v.len < n && occ[at(hi + v.len)] === EMPTY) hi++;
  return [lo, hi];
}

/**
 * What stops vehicle `i` going one bay further in direction `dir` (−1 or +1) from offset `off`:
 * a vehicle index, WALL for a planter, or null for the edge of the board.
 * This is what shivers when a slide is refused (design §4: a blocked slide shows what blocked it).
 */
export function blockerOf(p: Puzzle, pos: Pos, i: number, off: number, dir: -1 | 1, occ = occupancy(p, pos)): number | null {
  const v = p.vehicles[i]!;
  const n = p.size;
  const o = dir < 0 ? off - 1 : off + v.len;
  if (o < 0 || o >= n) return null;
  const who = occ[v.horiz ? v.lane * n + o : o * n + v.lane]!;
  return who === EMPTY || who === i ? null : who;
}

/** The van can leave: every bay above it in its column is empty. */
export function vanCanExit(p: Puzzle, pos: Pos, occ = occupancy(p, pos)): boolean {
  const col = p.vehicles[VAN]!.lane;
  for (let r = 0; r < pos[VAN]!; r++) if (occ[r * p.size + col] !== EMPTY) return false;
  return true;
}

/** Is sliding vehicle `i` to offset `to` a legal single move from `pos`? */
export function isLegal(p: Puzzle, pos: Pos, i: number, to: number): boolean {
  if (i < 0 || i >= p.vehicles.length || !Number.isInteger(to)) return false;
  const [lo, hi] = freeRange(p, pos, i);
  return to >= lo && to <= hi && to !== pos[i];
}

/** Draw a position back into a board string (letters kept as the puzzle names them). */
export function toBoard(p: Puzzle, pos: Pos): string {
  const out = new Array<string>(p.size * p.size).fill('.');
  for (const w of p.walls) out[w] = '#';
  for (let i = 0; i < p.vehicles.length; i++) {
    for (const c of cellsAt(p, i, pos[i]!)) out[c] = p.vehicles[i]!.letter;
  }
  return out.join('');
}
