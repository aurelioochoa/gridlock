// Every picture in the game, drawn in code (design §9: zero asset files).
//
// A sunny seaside postcard seen from above: glossy pebble-rounded vehicles with a specular
// streak, sand-grey tarmac with chalk bay lines, a stone sea wall with bunting, an aqua sea.
// Gradients and rounded paths only — no filters, which are what make SVG slow on a Chromebook.
//
// Vehicles are drawn upright, front at the top, in a 100 × 100·len box; the view rotates the
// horizontal ones. No vehicle has a face. No two pieces in a lot share a roof motif, so none
// differ by hue alone (design §9, §D).

import type { ParkKey } from '../sim/parks';


export const PAINTS = [
  { id: 'coral', hi: '#ff9a86', lo: '#e0604b' },
  { id: 'butter', hi: '#ffe08a', lo: '#e3ab32' },
  { id: 'sky', hi: '#8fd8ff', lo: '#3c98d6' },
  { id: 'lilac', hi: '#cdb8f5', lo: '#8a6cc6' },
  { id: 'sea', hi: '#6fe0bb', lo: '#249f7c' },
  { id: 'stone', hi: '#e6ded3', lo: '#a69a8b' },
] as const;

/** Short vehicles: hatchbacks with a roof motif each, and the pickup with its surfboard. */
export const SHORT_MOTIFS = ['stripes', 'spots', 'sunroof', 'roofbox', 'surfboard', 'checks', 'star', 'flower', 'zigzag', 'target'] as const;
/** Long vehicles: camper vans and minibuses. */
export const LONG_MOTIFS = ['poptop', 'rack', 'awning', 'kayak', 'solar', 'bikes'] as const;

export type Kind = 'van' | 'hatch' | 'pickup' | 'camper' | 'minibus';

export interface Look {
  kind: Kind;
  motif: string;
  paint: (typeof PAINTS)[number];
}

/** Deterministic look per vehicle: by length, in letter order, so a lot always looks the same. */
export function looksFor(lens: readonly number[]): Look[] {
  let s = 0;
  let l = 0;
  return lens.map((len, i) => {
    if (i === 0) return { kind: 'van', motif: 'cone', paint: PAINTS[4] };
    if (len === 2) {
      const motif = SHORT_MOTIFS[s % SHORT_MOTIFS.length]!;
      const paint = PAINTS[(s * 2 + 1) % 5]!;
      s++;
      return { kind: motif === 'surfboard' ? 'pickup' : 'hatch', motif, paint };
    }
    const motif = LONG_MOTIFS[l % LONG_MOTIFS.length]!;
    const paint = PAINTS[(l * 3 + 2) % 6]!;
    l++;
    return { kind: l % 2 === 1 ? 'camper' : 'minibus', motif, paint };
  });
}

/** Shared gradients, referenced by id from every inline SVG on the page. */
export function defsSvg(): string {
  const bodies = PAINTS.map(
    (p) => `<linearGradient id="gb-${p.id}" x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stop-color="${p.lo}"/><stop offset=".28" stop-color="${p.hi}"/>
      <stop offset=".72" stop-color="${p.hi}"/><stop offset="1" stop-color="${p.lo}"/></linearGradient>`,
  ).join('');
  return `<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
    ${bodies}
    <linearGradient id="gb-van" x1="0" x2="1"><stop offset="0" stop-color="#5fcfa9"/><stop offset=".3" stop-color="#aef5dc"/><stop offset=".7" stop-color="#aef5dc"/><stop offset="1" stop-color="#5fcfa9"/></linearGradient>
    <linearGradient id="g-glass" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#36506b"/><stop offset="1" stop-color="#1d2b3d"/></linearGradient>
    <linearGradient id="g-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#39c4d6"/><stop offset="1" stop-color="#8ce6e4"/></linearGradient>
    <linearGradient id="g-sea-dusk" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5a6fc2"/><stop offset="1" stop-color="#f3a07e"/></linearGradient>
    <linearGradient id="g-sand" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#f7e3b3"/><stop offset="1" stop-color="#ecd29a"/></linearGradient>
    <linearGradient id="g-tarmac" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#bdb6ad"/><stop offset="1" stop-color="#a8a198"/></linearGradient>
    <linearGradient id="g-wall" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d8cdbd"/><stop offset="1" stop-color="#a99a86"/></linearGradient>
    <radialGradient id="g-tub" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#e9946a"/><stop offset="1" stop-color="#b0572f"/></radialGradient>
  </defs></svg>`;
}

// ---- vehicles ----------------------------------------------------------------------------

function motifSvg(motif: string, H: number): string {
  const cy = H / 2;
  switch (motif) {
    case 'stripes':
      return `<rect x="36" y="14" width="9" height="${H - 28}" rx="3" fill="#fff" opacity=".85"/><rect x="55" y="14" width="9" height="${H - 28}" rx="3" fill="#fff" opacity=".85"/>`;
    case 'spots':
      return [[38, cy - 18], [62, cy - 8], [40, cy + 10], [60, cy + 22], [50, cy - 2]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="7" fill="#fff" opacity=".9"/>`).join('');
    case 'sunroof':
      return `<rect x="30" y="${cy - 18}" width="40" height="34" rx="8" fill="url(#g-glass)"/><rect x="34" y="${cy - 14}" width="14" height="6" rx="3" fill="#fff" opacity=".45"/>`;
    case 'roofbox':
      return `<rect x="28" y="${cy - 26}" width="44" height="50" rx="14" fill="#f4f1ec" stroke="#8c8478" stroke-width="2.5"/><line x1="50" y1="${cy - 22}" x2="50" y2="${cy + 20}" stroke="#8c8478" stroke-width="2.5"/>`;
    case 'checks': {
      let out = '';
      for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if ((r + c) % 2 === 0) out += `<rect x="${34 + c * 8}" y="${cy - 16 + r * 8}" width="8" height="8" fill="#fff" opacity=".9"/>`;
      return `<rect x="33" y="${cy - 17}" width="34" height="34" rx="3" fill="#2a2a33" opacity=".75"/>${out}`;
    }
    case 'star':
      return `<path d="M50 ${cy - 20} L56 ${cy - 6} L71 ${cy - 6} L59 ${cy + 3} L64 ${cy + 18} L50 ${cy + 9} L36 ${cy + 18} L41 ${cy + 3} L29 ${cy - 6} L44 ${cy - 6} Z" fill="#fff" opacity=".92"/>`;
    case 'flower':
      return [0, 72, 144, 216, 288]
        .map((a) => {
          const r = (a * Math.PI) / 180;
          return `<circle cx="${50 + Math.cos(r) * 11}" cy="${cy + Math.sin(r) * 11}" r="8" fill="#fff" opacity=".92"/>`;
        }).join('') + `<circle cx="50" cy="${cy}" r="6" fill="#ffd166"/>`;
    case 'zigzag':
      return `<polyline points="30,${cy - 22} 70,${cy - 10} 30,${cy + 2} 70,${cy + 14} 30,${cy + 26}" fill="none" stroke="#fff" stroke-width="7" stroke-linecap="round" stroke-linejoin="round" opacity=".9"/>`;
    case 'target':
      return `<circle cx="50" cy="${cy}" r="21" fill="#fff" opacity=".9"/><circle cx="50" cy="${cy}" r="14" fill="none" stroke="currentColor" stroke-width="5"/><circle cx="50" cy="${cy}" r="5" fill="currentColor"/>`;
    case 'surfboard':
      // An open pickup bed with a board lying in it.
      return `<rect x="22" y="${cy - 6}" width="56" height="${H / 2 - 4}" rx="8" fill="#5b4a3f" opacity=".75"/>
        <ellipse cx="50" cy="${cy + H / 4 - 2}" rx="13" ry="${H / 4 - 6}" fill="#fff6e0" stroke="#e98a3a" stroke-width="3"/>
        <line x1="50" y1="${cy + 6}" x2="50" y2="${H - 18}" stroke="#e98a3a" stroke-width="3"/>`;
    case 'poptop':
      return `<rect x="22" y="40" width="56" height="${H - 92}" rx="18" fill="#fffaf0" stroke="#d8cbb7" stroke-width="3"/>
        <line x1="26" y1="${cy}" x2="74" y2="${cy}" stroke="#d8cbb7" stroke-width="3"/>
        ${[cy - 60, cy + 60].map((y) => `<circle cx="16" cy="${y}" r="7" fill="url(#g-glass)"/><circle cx="84" cy="${y}" r="7" fill="url(#g-glass)"/>`).join('')}`;
    case 'rack': {
      let bars = '';
      for (let y = 50; y < H - 60; y += 22) bars += `<line x1="24" y1="${y}" x2="76" y2="${y}" stroke="#4b4b55" stroke-width="3"/>`;
      return `<rect x="24" y="46" width="52" height="${H - 108}" rx="6" fill="none" stroke="#4b4b55" stroke-width="3"/>${bars}
        <rect x="30" y="${cy - 52}" width="40" height="34" rx="6" fill="#ff8f6b" stroke="#a24a2e" stroke-width="2.5"/>
        <rect x="32" y="${cy + 8}" width="36" height="42" rx="6" fill="#4ab0e8" stroke="#1d6c9c" stroke-width="2.5"/>
        <line x1="50" y1="${cy - 52}" x2="50" y2="${cy - 18}" stroke="#a24a2e" stroke-width="2.5"/>`;
    }
    case 'awning': {
      let s = '';
      for (let y = 46, k = 0; y < H - 56; y += 20, k++) s += `<rect x="20" y="${y}" width="60" height="20" fill="${k % 2 ? '#fff' : '#ff6f6f'}"/>`;
      return `<g opacity=".95">${s}</g><rect x="20" y="46" width="60" height="${Math.floor((H - 102) / 20) * 20}" fill="none" stroke="#c94a4a" stroke-width="2"/>`;
    }
    case 'kayak':
      return `<line x1="26" y1="44" x2="26" y2="${H - 50}" stroke="#4b4b55" stroke-width="4"/><line x1="74" y1="44" x2="74" y2="${H - 50}" stroke="#4b4b55" stroke-width="4"/>
        <ellipse cx="50" cy="${cy}" rx="15" ry="${H / 2 - 52}" fill="#ffcf3f" stroke="#c78a00" stroke-width="3"/>
        <ellipse cx="50" cy="${cy}" rx="7" ry="16" fill="#3a3a44"/>`;
    case 'solar': {
      let p = '';
      for (let y = 46; y < H - 70; y += 34) p += `<rect x="24" y="${y}" width="24" height="30" rx="3" fill="#2e4f8f"/><rect x="52" y="${y}" width="24" height="30" rx="3" fill="#2e4f8f"/>`;
      return `${p}<line x1="36" y1="46" x2="36" y2="${H - 60}" stroke="#9fb7e6" stroke-width="1.5" opacity=".7"/>`;
    }
    case 'bikes':
      return [cy - 46, cy + 30]
        .map((y) => `<g fill="none" stroke="#3a3a44" stroke-width="4"><circle cx="50" cy="${y - 14}" r="11"/><circle cx="50" cy="${y + 14}" r="11"/><line x1="50" y1="${y - 14}" x2="50" y2="${y + 14}"/><line x1="38" y1="${y - 4}" x2="62" y2="${y - 4}"/></g>`)
        .join('');
    case 'cone':
      return `<path d="M50 ${H - 40} L36 ${cy - 6} L64 ${cy - 6} Z" fill="#e8b86a" stroke="#b07a2a" stroke-width="2.5"/>
        <path d="M41 ${cy + 6} L59 ${cy + 6} M44 ${cy + 20} L56 ${cy + 20}" stroke="#b07a2a" stroke-width="2"/>
        <circle cx="50" cy="${cy - 12}" r="17" fill="#ffd9e6" stroke="#e78fb0" stroke-width="2.5"/>
        <path d="M40 ${cy - 14} q10 -12 20 0 q-10 10 -16 2" fill="none" stroke="#e78fb0" stroke-width="2.5" stroke-linecap="round"/>
        <circle cx="50" cy="${cy - 30}" r="5" fill="#e0435c"/>`;
    default:
      return '';
  }
}

/** One vehicle, upright, front at the top. */
export function vehicleSvg(look: Look, len: number): string {
  const H = len * 100;
  const fill = look.kind === 'van' ? 'url(#gb-van)' : `url(#gb-${look.paint.id})`;
  const edge = look.kind === 'van' ? '#3fa784' : look.paint.lo;
  const long = len === 3;
  const tyres = [18, H - 40].map((y) => `<rect x="4" y="${y}" width="12" height="24" rx="5" fill="#2b2b33"/><rect x="84" y="${y}" width="12" height="24" rx="5" fill="#2b2b33"/>`).join('');
  const screenY = long ? 14 : 12;
  const glass = `<path d="M24 ${screenY + 22} Q50 ${screenY} 76 ${screenY + 22} L72 ${screenY + 34} Q50 ${screenY + 24} 28 ${screenY + 34} Z" fill="url(#g-glass)"/>
    <path d="M30 ${H - 20} Q50 ${H - 12} 70 ${H - 20} L68 ${H - 28} Q50 ${H - 22} 32 ${H - 28} Z" fill="url(#g-glass)" opacity=".85"/>`;
  const vanTrim = look.kind === 'van'
    ? `<rect x="14" y="${H / 2 - 6}" width="72" height="12" fill="#fff4dc"/><rect x="14" y="${H / 2 + 6}" width="72" height="5" fill="#ff9fb8"/>`
    : '';
  return `<svg class="art" viewBox="0 0 100 ${H}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true" focusable="false" style="color:${look.paint.lo}">
    ${tyres}
    <rect x="9" y="5" width="82" height="${H - 10}" rx="${long ? 30 : 32}" fill="${fill}" stroke="${edge}" stroke-width="3"/>
    ${vanTrim}
    ${glass}
    ${motifSvg(look.motif, H)}
    <path d="M18 ${H * 0.18} Q15 ${H / 2} 19 ${H * 0.82}" stroke="#fff" stroke-width="6" stroke-linecap="round" fill="none" opacity=".5"/>
  </svg>`;
}

export function planterSvg(): string {
  const petals = [[38, 38], [62, 40], [50, 58], [36, 60], [64, 62], [50, 36]]
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="9" fill="#ff8fc0" stroke="#e05f99" stroke-width="2"/><circle cx="${x}" cy="${y}" r="3" fill="#ffe27a"/>`).join('');
  return `<svg viewBox="0 0 100 100" width="100%" height="100%" aria-hidden="true" focusable="false">
    <ellipse cx="54" cy="58" rx="40" ry="40" fill="#000" opacity=".16"/>
    <circle cx="50" cy="50" r="40" fill="url(#g-tub)" stroke="#8a4020" stroke-width="3"/>
    <circle cx="50" cy="50" r="31" fill="#4f9a45"/>
    <circle cx="44" cy="46" r="20" fill="#68b85a"/>
    ${petals}
  </svg>`;
}

// ---- the backdrop ------------------------------------------------------------------------

/**
 * Sea, beach and sea wall above the tarmac. Units are bays: the tarmac is n × n starting at
 * y = STRIP, and the wall's gap is over the van's column. Car parks change only this (§9).
 */
export const STRIP = 1.6;

export function backdropSvg(park: ParkKey, n: number, gapCol: number): string {
  const W = n * 100;
  const S = STRIP * 100;
  const H = S + W;
  const dusk = park === 'sunset';
  const sea = dusk ? 'url(#g-sea-dusk)' : 'url(#g-sea)';
  const wallY = S - 30;
  const gapX = gapCol * 100;
  // Beach huts along the sand, skipping the gap.
  const hutColours = ['#ff8a75', '#7fd0ff', '#ffe08a', '#c3aef0', '#6fe0bb'];
  let huts = '';
  for (let c = 0; c < n; c++) {
    if (c === gapCol) continue;
    const x = c * 100 + 22;
    const col = hutColours[(c + n) % hutColours.length];
    huts += `<g transform="translate(${x} ${S - 78})"><rect width="56" height="38" rx="4" fill="${col}"/><rect y="0" width="56" height="10" fill="#fff" opacity=".6"/><rect x="21" y="14" width="14" height="24" fill="#fff" opacity=".7"/></g>`;
  }
  let feature = '';
  // The sea's feature sits off-centre away from the gap, clear of the two HUD pills in the corners.
  const fx = W / 2 + (gapCol < n / 2 ? 1 : -1) * W * 0.14;
  switch (park) {
    case 'harbour':
      feature = [fx - 50, fx + 40].map((x, k) => `<g transform="translate(${x} ${26 + k * 10})"><path d="M-26 0 L26 0 L18 14 L-18 14 Z" fill="${k ? '#ff8a75' : '#fff'}" stroke="#2f6f86" stroke-width="2"/><rect x="-2" y="-24" width="3" height="24" fill="#6b4a2f"/><path d="M2 -22 L18 -4 L2 -4 Z" fill="#fff"/></g>`).join('');
      break;
    case 'market':
      feature = `<g transform="translate(${fx - 70} 18)">${[0, 1, 2].map((k) => `<g transform="translate(${k * 48} 0)"><rect width="44" height="26" fill="${['#ff6f6f', '#4ab0e8', '#ffcf3f'][k]}"/>${[0, 1].map((j) => `<rect x="${6 + j * 20}" width="10" height="26" fill="#fff" opacity=".85"/>`).join('')}</g>`).join('')}</g>`;
      break;
    case 'lighthouse':
      feature = `<g transform="translate(${fx} 44)"><circle r="34" fill="#e9e2d4" stroke="#9b8f7c" stroke-width="3"/><circle r="24" fill="#e0435c"/><circle r="15" fill="#fff"/><circle r="8" fill="#ffd166"/></g>`;
      break;
    case 'pier':
      feature = `<g transform="translate(${fx} 0)"><rect x="-26" y="0" width="52" height="${wallY - 20}" fill="#b98b5e"/>${[12, 32, 52, 72, 92].filter((y) => y < wallY - 20).map((y) => `<line x1="-26" y1="${y}" x2="26" y2="${y}" stroke="#8a6340" stroke-width="2"/>`).join('')}
        <g transform="translate(0 36)"><circle r="30" fill="none" stroke="#fff" stroke-width="4"/>${[0, 45, 90, 135].map((a) => `<line x1="${-30 * Math.cos((a * Math.PI) / 180)}" y1="${-30 * Math.sin((a * Math.PI) / 180)}" x2="${30 * Math.cos((a * Math.PI) / 180)}" y2="${30 * Math.sin((a * Math.PI) / 180)}" stroke="#fff" stroke-width="2.5"/>`).join('')}${[0, 60, 120, 180, 240, 300].map((a) => `<circle cx="${30 * Math.cos((a * Math.PI) / 180)}" cy="${30 * Math.sin((a * Math.PI) / 180)}" r="6" fill="${['#ff6f6f', '#ffcf3f', '#4ab0e8'][a / 60 % 3]}"/>`).join('')}</g></g>`;
      break;
    case 'dune':
      feature = [fx - 50, fx + 30].map((x, k) => `<g transform="translate(${x} ${70 + k * 6})"><path d="M-30 18 L0 -22 L30 18 Z" fill="${k ? '#ff9a5a' : '#6fb7ff'}" stroke="#fff" stroke-width="3" stroke-linejoin="round"/><line x1="0" y1="-22" x2="0" y2="18" stroke="#fff" stroke-width="2"/></g>`).join('');
      break;
    case 'sunset': {
      let bulbs = '';
      for (let x = 20; x < W; x += 40) bulbs += `<circle cx="${x}" cy="${22 + Math.sin(x / 40) * 6}" r="6" fill="${['#ffe27a', '#ff8fc0', '#8fd8ff'][(x / 40) % 3 | 0]}"/>`;
      feature = `<path d="M0 18 Q${W / 4} 34 ${W / 2} 22 T${W} 22" stroke="#5b3a5a" stroke-width="2" fill="none"/>${bulbs}<circle cx="${fx}" cy="70" r="26" fill="#ffcf6a" opacity=".85"/>`;
      break;
    }
  }
  // Bunting over the gap.
  let flags = '';
  for (let k = 0; k < 5; k++) {
    const x = gapX + 8 + k * 21;
    flags += `<path d="M${x} ${wallY - 8 + (k % 2) * 3} l14 0 l-7 14 Z" fill="${['#ff6f6f', '#ffcf3f', '#4ab0e8', '#6fe0bb', '#c3aef0'][k]}"/>`;
  }
  // Chalk bay lines.
  let lines = '';
  for (let k = 1; k < n; k++) {
    lines += `<line x1="${k * 100}" y1="${S}" x2="${k * 100}" y2="${H}" stroke="#fff" stroke-width="2" opacity=".35" stroke-dasharray="14 10"/>`;
    lines += `<line x1="0" y1="${S + k * 100}" x2="${W}" y2="${S + k * 100}" stroke="#fff" stroke-width="2" opacity=".35" stroke-dasharray="14 10"/>`;
  }
  // Chevrons painted on the tarmac in the exit column: "this way to the beach".
  const arrows = `<path d="M${gapX + 36} ${S + 40} l14 -14 l14 14" stroke="#fff" stroke-width="5" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>`;
  return `<svg class="backdrop" viewBox="0 0 ${W} ${H}" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <rect width="${W}" height="${S}" fill="${sea}"/>
    <g class="waves" stroke="#fff" stroke-width="3" fill="none" opacity=".55" stroke-linecap="round">
      <path d="M10 30 q20 -10 40 0 t40 0"/><path d="M${W * 0.45} 52 q20 -10 40 0 t40 0"/><path d="M${W * 0.7} 22 q20 -10 40 0 t40 0"/><path d="M${W * 0.2} 68 q20 -10 40 0 t40 0"/>
    </g>
    ${feature}
    <path d="M0 ${S - 92} Q${W / 3} ${S - 104} ${W / 2} ${S - 94} T${W} ${S - 96} L${W} ${S} L0 ${S} Z" fill="url(#g-sand)"/>
    ${huts}
    <rect x="0" y="${wallY}" width="${gapX}" height="30" fill="url(#g-wall)"/>
    <rect x="${gapX + 100}" y="${wallY}" width="${W - gapX - 100}" height="30" fill="url(#g-wall)"/>
    <rect x="${gapX - 6}" y="${wallY - 6}" width="12" height="36" rx="4" fill="#9b8c77"/>
    <rect x="${gapX + 94}" y="${wallY - 6}" width="12" height="36" rx="4" fill="#9b8c77"/>
    <path d="M${gapX} ${wallY - 8} Q${gapX + 50} ${wallY + 4} ${gapX + 100} ${wallY - 8}" stroke="#6b5a48" stroke-width="2" fill="none"/>
    ${flags}
    <rect x="0" y="${S}" width="${W}" height="${W}" fill="url(#g-tarmac)"/>
    ${lines}
    ${arrows}
  </svg>`;
}

/** A small picture of a car park for its card on the map. */
export function vignetteSvg(park: ParkKey): string {
  return backdropSvg(park, 6, 2)
    .replace('class="backdrop"', 'class="vignette"')
    .replace('viewBox="0 0 600 760"', 'viewBox="0 0 600 160"')
    .replace('preserveAspectRatio="none"', 'preserveAspectRatio="xMidYMin slice"');
}

// ---- icons (24 × 24, currentColor) -------------------------------------------------------

const icon = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"${extra}>${body}</svg>`;

export const ICONS = {
  undo: icon('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  reset: icon('<path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 3v6h6"/>'),
  hint: icon('<path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/>'),
  map: icon('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2z"/><path d="M9 4v14"/><path d="M15 6v14"/>'),
  pause: icon('<path d="M8 5v14"/><path d="M16 5v14"/>'),
  play: icon('<path d="M7 4l13 8-13 8z" fill="currentColor"/>'),
  replay: icon('<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 3v6h-6"/>'),
  back: icon('<path d="M15 18l-6-6 6-6"/>'),
  soundOn: icon('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>'),
  soundOff: icon('<path d="M4 9h4l5-4v14l-5-4H4z" fill="currentColor"/><path d="M17 9l5 6"/><path d="M22 9l-5 6"/>'),
  calm: icon('<path d="M3 12c3-4 6-4 9 0s6 4 9 0"/>'),
  tyre: icon('<path d="M7 3v18M17 3v18" stroke-dasharray="2.5 2.5" stroke-width="3"/>'),
  star: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/></svg>`,
  cone: `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 23 7 11h10z" fill="#e8b86a" stroke="#b07a2a" stroke-width="1.2"/><circle cx="12" cy="8.5" r="5" fill="#ffd9e6" stroke="#e78fb0" stroke-width="1.2"/><circle cx="12" cy="3.6" r="1.6" fill="#e0435c"/></svg>`,
  lock: icon('<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
};
