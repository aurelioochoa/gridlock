import { parseBoard } from '../../src/sim/board';
import { buildGraph } from '../../src/sim/solver';
import { mulberry32, randInt } from '../../src/sim/rng';
// Depth rate by piece count, to tune the generator.
export default function main(args: string[]) {
  const walls = Number(args[0] ?? 0);
  const rng = mulberry32(7);
  const n = 6;
  for (let k = 8; k <= 15; k++) {
    let boards = 0, d14 = 0, d20 = 0, d28 = 0, states = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < 6000) {
      const cells = new Array(36).fill('.');
      const vc = randInt(rng, 0, 5), vr = randInt(rng, 1, 4);
      cells[vr * 6 + vc] = 'V'; cells[(vr + 1) * 6 + vc] = 'V';
      for (let w = 0; w < walls; w++) { const c = randInt(rng, 0, 35); if (cells[c] === '.' && !(c % 6 === vc && c / 6 < vr)) cells[c] = '#'; }
      let placed = 0;
      for (let a = 0; a < 300 && placed < k; a++) {
        const len = rng() < 0.72 ? 2 : 3, h = rng() < 0.5, lane = randInt(rng, 0, 5), off = randInt(rng, 0, 6 - len);
        if (!h && lane === vc) continue;
        const at = []; for (let q = 0; q < len; q++) at.push(h ? lane * 6 + off + q : (off + q) * 6 + lane);
        if (at.some((c) => cells[c] !== '.')) continue;
        for (const c of at) cells[c] = 'abcdefghijklmno'[placed]; placed++;
      }
      if (placed < k) continue;
      const p = parseBoard(cells.join(''));
      const g = buildGraph(p, p.start); boards++;
      if (!g) continue;
      states += g.count;
      let m = 0; for (let s = 0; s < g.count; s++) if (g.dist[s]! > m) m = g.dist[s]!;
      m += 1;
      if (m >= 14) d14++; if (m >= 20) d20++; if (m >= 28) d28++;
    }
    console.log(`k=${k} walls=${walls}: ${boards} boards (${(boards/6).toFixed(0)}/s, ${Math.round(states/boards)} st) ≥14 ${d14} ≥20 ${d20} ≥28 ${d28}`);
  }
}
