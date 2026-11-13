// One puzzle, one spelling, one id.
//
// A board and its left-right mirror are the same puzzle (the exit stays at the top), and the
// letters are only names, so the canonical form relabels vehicles a, b, c… in reading order
// and keeps whichever of the board and its mirror sorts first (design §B step 5).
// A lot's id is a hash of its board, not its list position, so reordering a band never moves
// a kid's stars onto another board (design §C).

export function relabel(board: string): string {
  const map = new Map<string, string>();
  let next = 'a'.charCodeAt(0);
  let out = '';
  for (const ch of board) {
    if (ch === '.' || ch === '#' || ch === 'V') {
      out += ch;
      continue;
    }
    let to = map.get(ch);
    if (!to) {
      to = String.fromCharCode(next++);
      map.set(ch, to);
    }
    out += to;
  }
  return out;
}

export function mirror(board: string): string {
  const n = board.length === 25 ? 5 : 6;
  let out = '';
  for (let r = 0; r < n; r++) {
    for (let c = n - 1; c >= 0; c--) out += board[r * n + c];
  }
  return out;
}

export function canonical(board: string): string {
  const a = relabel(board);
  const b = relabel(mirror(board));
  return a <= b ? a : b;
}

/** FNV-1a, 32 bits, base 36: short, stable, and plenty for a few hundred boards. */
export function lotId(board: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < board.length; i++) {
    h ^= board.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}
