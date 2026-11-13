// Which puzzle family a lot belongs to.
//
// Every position reachable from a start is the same puzzle with a different opening, so the
// generator takes at most one lot per component (design §B step 5) and lots.test.ts checks it.
// The id is the smallest drawing of any position in the component, with vehicles drawn by
// shape rather than letter and mirrors folded together — so it does not depend on which
// position the lot starts from or what the letters happen to be.

import type { Graph } from './solver';
import { mirror } from './canon';

export function componentId(g: Graph): string {
  const p = g.p;
  const n = p.size;
  const V = p.vehicles.length;
  const glyph = p.vehicles.map((v, i) => (i === 0 ? 'V' : v.horiz ? (v.len === 2 ? 'h' : 'H') : v.len === 2 ? 'u' : 'U'));
  const base = new Array<string>(n * n).fill('.');
  for (const w of p.walls) base[w] = '#';
  let best: string | null = null;
  const cells = base.slice();
  for (let s = 0; s < g.count; s++) {
    for (let k = 0; k < cells.length; k++) cells[k] = base[k]!;
    for (let i = 0; i < V; i++) {
      const v = p.vehicles[i]!;
      const o = g.states[s * V + i]!;
      for (let k = 0; k < v.len; k++) cells[v.horiz ? v.lane * n + o + k : (o + k) * n + v.lane] = glyph[i]!;
    }
    const a = cells.join('');
    const b = mirror(a);
    const m = a < b ? a : b;
    if (best === null || m < best) best = m;
  }
  return best ?? '';
}
