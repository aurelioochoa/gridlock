// Pause, result and map: DOM glass panels, built locally (design §9). Every one has a way
// out a kid can find without an adult, and every one works on arrows, Enter/Space and Esc.

import { t } from '../i18n';
import { ICONS, vignetteSvg } from '../view/art';
import { PARKS, UNLOCK_SOLVES, type ParkKey } from '../sim/parks';

export interface LotInfo {
  id: string;
  band: ParkKey;
  /** 1-based number inside its car park. */
  n: number;
  stars: number;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function button(cls: string, html: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = el('button', cls, html);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', onClick);
  return b;
}

const stars = (n: number, cls = '') =>
  [0, 1, 2].map((k) => ICONS.star.replace('<svg ', `<svg class="${k < n ? 'on' : ''} ${cls}" `)).join('');

export function pausePanel(opts: {
  muted: boolean;
  calm: boolean;
  onResume: () => void;
  onMap: () => void;
  onSound: () => void;
  onCalm: () => void;
}): HTMLElement {
  const wrap = el('div', 'overlay');
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  const panel = el('div', 'panel');
  panel.append(el('h2', '', escape(t('pause.title'))));
  const resume = button('btn big primary wide', `${ICONS.play}<span>${escape(t('pause.resume'))}</span>`, '', opts.onResume);
  const map = button('btn big wide', `${ICONS.map}<span>${escape(t('tool.map'))}</span>`, '', opts.onMap);
  const sound = button('btn big wide', `${opts.muted ? ICONS.soundOff : ICONS.soundOn}<span>${escape(t('tool.sound'))}</span>`, '', opts.onSound);
  sound.setAttribute('aria-pressed', String(!opts.muted));
  const calm = button('btn big wide', `${ICONS.calm}<span>${escape(t('pause.calm'))}</span>`, '', opts.onCalm);
  calm.setAttribute('aria-pressed', String(opts.calm));
  panel.append(resume, map, sound, calm);
  wrap.append(panel);
  wrap.dataset.kind = 'pause';
  return wrap;
}

export function resultPanel(opts: {
  stars: number;
  moves: number;
  best: number;
  hasNext: boolean;
  onNext: () => void;
  onReplay: () => void;
  onMap: () => void;
}): HTMLElement {
  const wrap = el('div', 'overlay');
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  const panel = el('div', 'panel');
  panel.append(el('h2', '', escape(t('result.title'))));
  const row = el('div', 'stars', stars(0));
  row.setAttribute('role', 'img');
  row.setAttribute('aria-label', t('map.stars', { n: opts.stars }));
  panel.append(row);
  const moves = el('div', 'result-moves', `${ICONS.tyre}<span>${escape(t('result.moves', { moves: opts.moves, best: opts.best }))}</span>`);
  panel.append(moves);
  const buttons = el('div', 'row');
  const next = button('btn big primary', ICONS.play, t('result.next'), opts.onNext);
  if (!opts.hasNext) next.hidden = true;
  buttons.append(next, button('btn big', ICONS.replay, t('result.replay'), opts.onReplay), button('btn big', ICONS.map, t('tool.map'), opts.onMap));
  panel.append(buttons);
  wrap.append(panel);
  wrap.dataset.kind = 'result';
  return wrap;
}

/** Fill the result card's stars one by one; `chime` plays per star. */
export function fillStars(panel: HTMLElement, n: number, calm: boolean, chime: (k: number) => void): void {
  const svgs = [...panel.querySelectorAll<SVGElement>('.stars svg')];
  svgs.forEach((s, k) => {
    if (k >= n) return;
    window.setTimeout(() => {
      s.classList.add('on');
      chime(k);
    }, calm ? 0 : 260 + k * 260);
  });
}

export function mapScreen(opts: {
  lots: LotInfo[];
  open: (park: ParkKey) => boolean;
  solvedIn: (park: ParkKey) => number;
  currentId: string | null;
  onPick: (id: string) => void;
  onBack: () => void;
}): HTMLElement {
  const wrap = el('div', 'map');
  wrap.dataset.kind = 'map';
  const header = el('header');
  header.append(button('btn', ICONS.back, t('map.back'), opts.onBack), el('h1', '', escape(t('map.title'))));
  wrap.append(header);
  const list = el('div', 'parks');
  PARKS.forEach((park, k) => {
    const card = el('section', 'park');
    const lots = opts.lots.filter((l) => l.band === park.key);
    const total = lots.reduce((s, l) => s + l.stars, 0);
    const pic = el('div', 'pic', vignetteSvg(park.key));
    const title = el('div', 'title');
    title.append(el('span', '', escape(t(`park.${park.key}`))), el('span', 'count', `${ICONS.star}<span>${total}/${lots.length * 3}</span>`));
    card.append(pic, title);
    card.setAttribute('aria-label', t(`park.${park.key}`));
    if (opts.open(park.key)) {
      const grid = el('div', 'lots');
      for (const l of lots) {
        const label = `${t('map.lot', { n: l.n })}, ${l.stars ? t('map.stars', { n: l.stars }) : t('map.unsolved')}`;
        const b = button('lot', `<span>${l.n}</span><span class="pips">${stars(l.stars)}</span>`, label, () => opts.onPick(l.id));
        b.dataset.id = l.id;
        if (l.id === opts.currentId) b.classList.add('current');
        grid.append(b);
      }
      card.append(grid);
    } else {
      card.classList.add('locked');
      const prev = PARKS[k - 1]!;
      const need = Math.max(0, UNLOCK_SOLVES - opts.solvedIn(prev.key));
      const lock = el('div', 'lock');
      lock.setAttribute('role', 'img');
      lock.setAttribute('aria-label', t('map.locked', { n: need, park: t(`park.${prev.key}`) }));
      const dots = el('div', 'dots');
      for (let d = 0; d < UNLOCK_SOLVES; d++) dots.append(el('i', d < UNLOCK_SOLVES - need ? 'on' : ''));
      lock.innerHTML = ICONS.lock;
      lock.append(dots);
      card.append(lock);
    }
    list.append(card);
  });
  wrap.append(list);
  return wrap;
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
