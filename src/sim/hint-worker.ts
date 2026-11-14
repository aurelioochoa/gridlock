// The hint, off the main thread (design §12: timed at 4× CPU throttle before content was
// generated; the biggest lot's BFS took ~870 ms there, so it lives in a Web Worker).
//
// The game posts `prepare` when a lot opens, so the whole component is solved in the
// background before a kid ever asks; a `hint` then answers from the cached distance table.

import { parseBoard } from './board';
import { buildGraph, hintFrom, type Graph, type Move } from './solver';

export type HintRequest = { kind: 'prepare'; board: string } | { kind: 'hint'; board: string; pos: number[]; seq: number };
export type HintReply = { kind: 'hint'; seq: number; move: Move | null };

let cached: { board: string; g: Graph } | null = null;

function graphFor(board: string): Graph {
  if (cached?.board !== board) {
    const p = parseBoard(board);
    cached = { board, g: buildGraph(p, p.start)! };
  }
  return cached.g;
}

self.onmessage = (e: MessageEvent<HintRequest>) => {
  const msg = e.data;
  const g = graphFor(msg.board);
  if (msg.kind === 'hint') {
    const reply: HintReply = { kind: 'hint', seq: msg.seq, move: hintFrom(g, msg.pos) };
    (self as unknown as Worker).postMessage(reply);
  }
};
