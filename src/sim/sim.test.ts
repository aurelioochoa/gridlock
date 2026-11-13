import { describe, expect, it } from 'vitest';
import { parseBoard, freeRange, blockerOf, vanCanExit, isLegal, toBoard, BoardError, WALL } from './board';
import { buildGraph, statsOf, solutionFrom, hintFrom, distanceOf, optOf, EXIT } from './solver';
import { pushMove, positionOf, moveCount, undo, reset, pushExit, isSolved, pack, unpack, type Entry } from './history';
import { canonical, mirror, relabel, lotId } from './canon';
import { starsFor } from './parks';

const solve = (board: string) => {
  const p = parseBoard(board);
  const g = buildGraph(p, p.start)!;
  return { p, g, stats: statsOf(g, p.start) };
};

describe('parseBoard', () => {
  it('reads vehicles, lanes and offsets, van first', () => {
    const p = parseBoard('.....' + '.aa..' + '..V..' + '..V..' + '..bbb');
    expect(p.size).toBe(5);
    expect(p.vehicles.map((v) => v.letter)).toEqual(['V', 'a', 'b']);
    expect(p.vehicles[0]).toEqual({ letter: 'V', len: 2, horiz: false, lane: 2 });
    expect(p.vehicles[2]).toEqual({ letter: 'b', len: 3, horiz: true, lane: 4 });
    expect(p.start).toEqual([2, 1, 2]);
  });

  it('refuses broken boards', () => {
    expect(() => parseBoard('....')).toThrow(BoardError);
    expect(() => parseBoard('.'.repeat(25))).toThrow(/no van/);
    expect(() => parseBoard('VV...' + '.'.repeat(20))).toThrow(/upright/);
    expect(() => parseBoard('a....' + '.a...' + 'V....' + 'V....' + '.....')).toThrow(/straight/);
    expect(() => parseBoard('aaaa.' + '.....' + 'V....' + 'V....' + '.....')).toThrow(/length 4/);
    expect(() => parseBoard('a.a..' + '.....' + 'V....' + 'V....' + '.....')).toThrow(/contiguous/);
    expect(() => parseBoard('z....' + '.....' + 'V....' + 'V....' + '.....')).toThrow(/unknown/);
  });

  it('round-trips through toBoard', () => {
    const b = '..b..' + 'aab..' + '.Vb..' + '.V...' + '...#.';
    const p = parseBoard(b);
    expect(toBoard(p, p.start)).toBe(b);
  });
});

describe('sliding rules', () => {
  const b = '..b..' + 'aab..' + '.Vb..' + '.V...' + '...#.';
  const p = parseBoard(b);

  it('clamps a slide to the free bays on each side', () => {
    expect(freeRange(p, p.start, 1)).toEqual([0, 0]); // the car: wall left, camper right
    expect(freeRange(p, p.start, 2)).toEqual([0, 2]); // the camper can drop two bays
    expect(freeRange(p, p.start, 0)).toEqual([2, 3]); // the van: car above, open below
  });

  it('names what blocks a slide, or null for the edge', () => {
    expect(blockerOf(p, p.start, 1, 0, 1)).toBe(2);
    expect(blockerOf(p, p.start, 1, 0, -1)).toBeNull();
    expect(blockerOf(p, p.start, 0, 2, -1)).toBe(1);
    const q = parseBoard('.....' + '.....' + '..V..' + '..V..' + '..#..');
    expect(blockerOf(q, q.start, 0, 2, 1)).toBe(WALL);
  });

  it('knows when the van can leave', () => {
    expect(vanCanExit(p, p.start)).toBe(false);
    const pos = p.start.slice();
    pos[2] = 2;
    pos[1] = 2;
    expect(vanCanExit(p, pos)).toBe(true);
  });

  it('only allows slides into free bays', () => {
    expect(isLegal(p, p.start, 2, 2)).toBe(true);
    expect(isLegal(p, p.start, 1, 1)).toBe(false);
    expect(isLegal(p, p.start, 2, 0)).toBe(false); // not a move: it is already there
    expect(isLegal(p, p.start, 9, 0)).toBe(false);
  });
});

describe('solver', () => {
  it('one car in the way: slide it, drive out', () => {
    const { stats } = solve('.....' + '.aa..' + '..V..' + '..V..' + '.....');
    expect(stats).toMatchObject({ opt: 2, movers: 2 });
  });

  it('a car that can only go one way', () => {
    const { p, g } = solve('.....' + '...aa' + '...V.' + '...V.' + '.....');
    expect(hintFrom(g, p.start)).toEqual({ v: 1, to: 1 });
  });

  it('a camper has to back down out of a car’s way, and a car out of the camper’s', () => {
    // a is pinned by the camper b; b cannot drop while c sits under it.
    const { p, g, stats } = solve('..b..' + 'aab..' + '..b..' + 'Vcc..' + 'V....');
    expect(stats).toMatchObject({ opt: 4, movers: 4 });
    expect(solutionFrom(g, p.start)).toEqual([
      { v: 3, to: 3 },
      { v: 2, to: 2 },
      { v: 1, to: 1 },
      { v: 0, to: EXIT },
    ]);
  });

  it('counts one slide of any distance as one move', () => {
    // The car goes four bays in one drag.
    const { stats } = solve('......' + 'aa....' + 'V.....' + 'V.....' + '......' + '......');
    expect(stats?.opt).toBe(2);
  });

  it('a van boxed in for good has no solution', () => {
    // An upright piece above the van in its own column can never leave it.
    const { p, g } = solve('..a..' + '..a..' + '..V..' + '..V..' + '.....');
    expect(distanceOf(g, p.start)).toBe(-1);
    expect(optOf(g, p.start)).toBe(-1);
    expect(hintFrom(g, p.start)).toBeNull();
  });

  it('refuses a component over the state limit', () => {
    const p = parseBoard('..b..' + 'aab..' + '..b..' + 'Vcc..' + 'V....');
    expect(buildGraph(p, p.start, 5)).toBeNull();
  });

  it('hints from wherever the kid has got to', () => {
    const { p, g } = solve('..b..' + 'aab..' + '..b..' + 'Vcc..' + 'V....');
    const pos = p.start.slice();
    pos[3] = 3; // c already moved
    expect(hintFrom(g, pos)).toEqual({ v: 2, to: 2 });
    pos[2] = 2;
    pos[1] = 2;
    expect(hintFrom(g, pos)).toEqual({ v: 0, to: EXIT });
  });
});

describe('move history', () => {
  const p = parseBoard('..b..' + 'aab..' + '..b..' + 'Vcc..' + 'V....');

  it('three slides of one vehicle are one move', () => {
    let h: Entry[] = [];
    h = pushMove(h, 3, 1, 2);
    h = pushMove(h, 3, 2, 3);
    h = pushMove(h, 3, 3, 2);
    expect(moveCount(h)).toBe(1);
    expect(h).toEqual([{ v: 3, from: 1, to: 2 }]);
  });

  it('there and back again is no move at all', () => {
    let h: Entry[] = [];
    h = pushMove(h, 3, 1, 3);
    h = pushMove(h, 3, 3, 1);
    expect(moveCount(h)).toBe(0);
    expect(h).toEqual([]);
  });

  it('undo takes back one whole move and shortens the count', () => {
    let h: Entry[] = [];
    h = pushMove(h, 3, 1, 3);
    h = pushMove(h, 2, 0, 2);
    expect(moveCount(h)).toBe(2);
    h = undo(h);
    expect(moveCount(h)).toBe(1);
    expect(positionOf(p, h)).toEqual([3, 0, 0, 3]);
  });

  it('reset starts again, and can itself be undone', () => {
    let h: Entry[] = [];
    h = pushMove(h, 3, 1, 3);
    h = pushMove(h, 2, 0, 2);
    h = reset(p, h);
    expect(moveCount(h)).toBe(0);
    expect(positionOf(p, h)).toEqual(p.start);
    expect(reset(p, h)).toEqual(h); // nothing to reset
    h = undo(h);
    expect(moveCount(h)).toBe(2);
    expect(positionOf(p, h)).toEqual([3, 0, 2, 3]);
  });

  it('the van rolls out only through a clear column, and that is a move', () => {
    let h: Entry[] = [];
    expect(pushExit(p, h)).toBeNull();
    h = pushMove(h, 3, 1, 3);
    h = pushMove(h, 2, 0, 2);
    h = pushMove(h, 1, 0, 1);
    expect(isSolved(h)).toBe(false);
    h = pushExit(p, h)!;
    expect(isSolved(h)).toBe(true);
    expect(moveCount(h)).toBe(4);
  });

  it('a van slide that ends in rolling out is one move', () => {
    const q = parseBoard('.....' + '.....' + '..V..' + '..V..' + '.....');
    let h: Entry[] = pushMove([], 0, 2, 1);
    h = pushExit(q, h)!;
    expect(moveCount(h)).toBe(1);
  });

  it('packs and unpacks a history, refusing anything illegal', () => {
    let h: Entry[] = [];
    h = pushMove(h, 3, 1, 3);
    h = reset(p, h);
    h = pushMove(h, 3, 1, 2);
    expect(unpack(p, pack(h))).toEqual(h);
    expect(unpack(p, [[1, 0, 1]])).toBeNull(); // the car is pinned at the start
    expect(unpack(p, [[3, 2, 3]])).toBeNull(); // wrong `from`
    expect(unpack(p, 'nope')).toBeNull();
    expect(unpack(p, [[0, 3, EXIT]])).toBeNull();
  });
});

describe('canonical form and ids', () => {
  const b = '..b..' + 'aab..' + '..b..' + 'Vcc..' + 'V....';
  it('relabels in reading order', () => {
    expect(relabel('..x..' + 'yyx..' + '..x..' + 'Vzz..' + 'V....')).toBe('..a..' + 'bba..' + '..a..' + 'Vcc..' + 'V....');
  });
  it('treats a board and its mirror as one puzzle', () => {
    expect(canonical(b)).toBe(canonical(mirror(b)));
    expect(mirror(mirror(b))).toBe(b);
  });
  it('gives stable, distinct ids', () => {
    expect(lotId(b)).toBe(lotId(b));
    expect(lotId(b)).not.toBe(lotId(mirror(b)));
    expect(lotId(b)).toMatch(/^[0-9a-z]{7}$/);
  });
});

describe('stars', () => {
  it('★★★ is the shortest way, by yourself', () => {
    expect(starsFor(5, 5, false)).toBe(3);
    expect(starsFor(6, 5, false)).toBe(2);
    expect(starsFor(8, 5, false)).toBe(2);
    expect(starsFor(9, 5, false)).toBe(1);
    expect(starsFor(40, 30, false)).toBe(2);
    expect(starsFor(46, 30, false)).toBe(1);
  });
  it('a hinted solve keeps up to ★★, and every solve earns a star', () => {
    expect(starsFor(5, 5, true)).toBe(2);
    expect(starsFor(99, 5, true)).toBe(1);
    expect(starsFor(99, 5, false)).toBe(1);
  });
});
