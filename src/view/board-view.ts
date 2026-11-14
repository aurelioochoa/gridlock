// The board on screen: an SVG backdrop, one real <button> per vehicle moved by CSS transform,
// planters, the hint ghost and the HUD (design §12). Buttons give focus, Enter/Space and
// accessible names for free, which is the hard part of a turn-based board.
//
// requestAnimationFrame runs only while something slides, so an idle board costs nothing.

import type { Puzzle } from '../sim/board';
import { looksFor, vehicleSvg, planterSvg, backdropSvg, STRIP, ICONS, type Look } from './art';
import type { ParkKey } from '../sim/parks';

const CHEV = `<svg viewBox="0 0 24 24"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

interface Tween {
  i: number;
  from: number;
  to: number;
  t0: number;
  ms: number;
  ease: (x: number) => number;
  done?: () => void;
}

export const easeOut = (x: number) => 1 - (1 - x) * (1 - x) * (1 - x);
export const easeIn = (x: number) => x * x * x;
export const linear = (x: number) => x;

export class BoardView {
  readonly stage: HTMLDivElement;
  readonly layer: HTMLDivElement;
  readonly buttons: HTMLButtonElement[] = [];
  readonly looks: Look[];
  /** Displayed offset of each vehicle along its lane, in bays (fractional while moving). */
  readonly disp: number[];
  readonly movesHud: HTMLDivElement;
  readonly scoopsHud: HTMLDivElement;
  cell = 64;
  private tweens = new Map<number, Tween>();
  private raf = 0;
  private ghost: HTMLDivElement | null = null;
  private coachEl: HTMLDivElement | null = null;
  private planters: HTMLDivElement[] = [];

  constructor(readonly p: Puzzle, park: ParkKey, pos: number[]) {
    this.disp = pos.slice();
    this.looks = looksFor(p.vehicles.map((v) => v.len));
    this.stage = document.createElement('div');
    this.stage.className = 'stage';
    this.stage.setAttribute('role', 'group');
    this.stage.innerHTML = backdropSvg(park, p.size, p.vehicles[0]!.lane);
    this.layer = document.createElement('div');
    this.layer.className = 'layer';
    this.stage.append(this.layer);

    for (const w of p.walls) {
      const d = document.createElement('div');
      d.className = 'planter';
      d.setAttribute('role', 'img');
      d.innerHTML = planterSvg();
      d.dataset.cell = String(w);
      this.planters.push(d);
      this.layer.append(d);
    }
    p.vehicles.forEach((v, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'veh';
      b.dataset.v = String(i);
      b.tabIndex = -1;
      const look = this.looks[i]!;
      // Which way the vehicle faces is fixed per letter, so a lot always looks the same.
      const flip = i === 0 ? false : (v.letter.charCodeAt(0) + v.lane) % 2 === 1;
      const deg = v.horiz ? (flip ? -90 : 90) : flip ? 180 : 0;
      b.innerHTML = `<div class="shadow"></div><div class="body"><div class="rot" style="transform:rotate(${deg}deg)">${vehicleSvg(look, v.len)}</div></div>
        <span class="chev lo">${CHEV}</span><span class="chev hi">${CHEV}</span>${i === 0 ? `<span class="chev up">${CHEV}</span>` : ''}`;
      this.buttons.push(b);
      this.layer.append(b);
    });

    this.movesHud = document.createElement('div');
    this.movesHud.className = 'hud moves';
    this.movesHud.setAttribute('role', 'status');
    this.scoopsHud = document.createElement('div');
    this.scoopsHud.className = 'hud scoops';
    this.stage.append(this.movesHud, this.scoopsHud);
  }

  layout(cell: number): void {
    this.cell = cell;
    const n = this.p.size;
    this.stage.style.width = `${n * cell}px`;
    this.stage.style.height = `${(n + STRIP) * cell}px`;
    this.stage.style.setProperty('--cell', `${cell}px`);
    this.layer.style.top = `${STRIP * cell}px`;
    this.layer.style.width = `${n * cell}px`;
    this.layer.style.height = `${n * cell}px`;
    this.p.vehicles.forEach((v, i) => {
      const b = this.buttons[i]!;
      const w = v.horiz ? v.len * cell : cell;
      const h = v.horiz ? cell : v.len * cell;
      b.style.width = `${w}px`;
      b.style.height = `${h}px`;
      const rot = b.querySelector<HTMLElement>('.rot')!;
      const long = v.len * cell;
      rot.style.width = `${cell * 0.92}px`;
      rot.style.height = `${long * 0.92}px`;
      rot.style.left = `${(w * 0.92 - cell * 0.92) / 2}px`;
      rot.style.top = `${(h * 0.92 - long * 0.92) / 2}px`;
      this.placeChevrons(i);
      this.place(i);
    });
    for (const d of this.planters) {
      const c = Number(d.dataset.cell);
      d.style.width = d.style.height = `${cell}px`;
      d.style.transform = `translate(${(c % n) * cell}px, ${Math.floor(c / n) * cell}px)`;
    }
    if (this.ghost) this.ghost.remove(), (this.ghost = null);
    this.positionCoach();
  }

  private placeChevrons(i: number): void {
    const v = this.p.vehicles[i]!;
    const b = this.buttons[i]!;
    const lo = b.querySelector<HTMLElement>('.chev.lo')!;
    const hi = b.querySelector<HTMLElement>('.chev.hi')!;
    const up = b.querySelector<HTMLElement>('.chev.up');
    const set = (el: HTMLElement, css: string, deg: number) => {
      el.style.cssText = css;
      el.style.transform = `rotate(${deg}deg)`;
    };
    if (v.horiz) {
      set(lo, 'left:-16%;top:33%;width:30%', -90);
      set(hi, 'right:-16%;top:33%;width:30%', 90);
      lo.style.width = hi.style.width = `${this.cell * 0.34}px`;
      lo.style.left = `${-this.cell * 0.2}px`;
      hi.style.right = `${-this.cell * 0.2}px`;
      lo.style.top = hi.style.top = `${this.cell * 0.33}px`;
    } else {
      set(lo, '', 0);
      set(hi, '', 180);
      lo.style.width = hi.style.width = `${this.cell * 0.34}px`;
      lo.style.left = hi.style.left = `${this.cell * 0.33}px`;
      lo.style.top = `${-this.cell * 0.2}px`;
      hi.style.bottom = `${-this.cell * 0.2}px`;
    }
    if (up) {
      up.style.width = `${this.cell * 0.42}px`;
      up.style.left = `${this.cell * 0.29}px`;
      up.style.top = `${-this.cell * 0.5}px`;
    }
  }

  /** Light the chevrons on the ends that can move (held state, design §10). */
  setChevrons(i: number, canLo: boolean, canHi: boolean): void {
    const b = this.buttons[i]!;
    b.querySelector('.chev.lo')!.classList.toggle('can', canLo);
    b.querySelector('.chev.hi')!.classList.toggle('can', canHi);
  }

  place(i: number, squash = 1): void {
    const v = this.p.vehicles[i]!;
    const d = this.disp[i]!;
    const x = v.horiz ? d * this.cell : v.lane * this.cell;
    const y = v.horiz ? v.lane * this.cell : d * this.cell;
    this.buttons[i]!.style.transform = `translate(${x}px, ${y}px)` + (squash !== 1 ? (v.horiz ? ` scaleX(${squash})` : ` scaleY(${squash})`) : '');
  }

  /** Slide a vehicle's picture to an offset. */
  animate(i: number, to: number, ms: number, ease = easeOut, done?: () => void): void {
    const prev = this.tweens.get(i);
    if (prev?.done) prev.done();
    if (ms <= 0 || this.disp[i] === to) {
      this.tweens.delete(i);
      this.disp[i] = to;
      this.place(i);
      done?.();
      return;
    }
    const tw: Tween = { i, from: this.disp[i]!, to, t0: performance.now(), ms, ease };
    if (done) tw.done = done;
    this.tweens.set(i, tw);
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  /** Jump any running slide of `i` to its end. */
  settle(i: number): void {
    const tw = this.tweens.get(i);
    if (!tw) return;
    this.tweens.delete(i);
    this.disp[i] = tw.to;
    this.place(i);
    tw.done?.();
  }

  isAnimating(): boolean {
    return this.tweens.size > 0;
  }

  private tick = (now: number): void => {
    this.raf = 0;
    for (const tw of [...this.tweens.values()]) {
      const k = Math.min(1, (now - tw.t0) / tw.ms);
      this.disp[tw.i] = tw.from + (tw.to - tw.from) * tw.ease(k);
      this.place(tw.i);
      if (k >= 1) {
        this.tweens.delete(tw.i);
        tw.done?.();
      }
    }
    if (this.tweens.size) this.raf = requestAnimationFrame(this.tick);
  };

  /** One-shot CSS effect on a vehicle: wiggle, shiver, squash, hop. */
  fx(i: number, name: 'wiggle' | 'shiver' | 'squash' | 'hop' | 'ringbump'): void {
    const b = this.buttons[i];
    if (!b) return;
    const v = this.p.vehicles[i]!;
    const cls = name === 'hop' || name === 'ringbump' ? name : `${name}-${v.horiz ? 'x' : 'y'}`;
    b.classList.remove(cls);
    void b.offsetWidth;
    b.classList.add(cls);
    const body = b.querySelector('.body')!;
    const clear = () => b.classList.remove(cls);
    body.addEventListener('animationend', clear, { once: true });
    // Calm motion has no animation to end: drop the highlight after a beat.
    window.setTimeout(clear, 700);
  }

  showGhost(i: number, to: number | 'exit'): void {
    this.clearGhost();
    const v = this.p.vehicles[i]!;
    const g = document.createElement('div');
    g.className = 'ghost';
    const c = this.cell;
    if (to === 'exit') {
      g.style.cssText = `left:${v.lane * c + c * 0.08}px;top:${-STRIP * c * 0.9}px;width:${c * 0.84}px;height:${c * 1.2}px`;
    } else {
      const x = v.horiz ? to * c : v.lane * c;
      const y = v.horiz ? v.lane * c : to * c;
      const w = v.horiz ? v.len * c : c;
      const h = v.horiz ? c : v.len * c;
      g.style.cssText = `left:${x + c * 0.06}px;top:${y + c * 0.06}px;width:${w - c * 0.12}px;height:${h - c * 0.12}px`;
    }
    this.ghost = g;
    this.layer.append(g);
  }

  clearGhost(): void {
    this.ghost?.remove();
    this.ghost = null;
  }

  /** The first-visit teaching mark on Harbour 1 (design §3): pulsing ends plus a hand or keycaps. */
  showCoach(i: number, keyboard: boolean): void {
    this.hideCoach();
    const b = this.buttons[i]!;
    b.classList.add('coach');
    const el = document.createElement('div');
    el.className = 'coach-hint';
    el.dataset.v = String(i);
    el.innerHTML = keyboard
      ? `<span class="keycap">←</span><span class="keycap">→</span><span class="keycap">Space</span>`
      : `<svg class="hand" viewBox="0 0 48 48" aria-hidden="true"><path d="M18 40c-4-3-9-9-10-12-.6-1.6 1.5-3 3-2l5 4V10a3 3 0 0 1 6 0v12h1v-4a3 3 0 0 1 6 0v4h1v-3a3 3 0 0 1 6 0v4h1v-2a3 3 0 0 1 6 0v9c0 6-3 12-8 12H18z" fill="#fff" stroke="#213547" stroke-width="2.5" stroke-linejoin="round"/></svg>`;
    this.coachEl = el;
    this.layer.append(el);
    this.positionCoach();
  }

  private positionCoach(): void {
    const el = this.coachEl;
    if (!el) return;
    const i = Number(el.dataset.v);
    const v = this.p.vehicles[i]!;
    const c = this.cell;
    const x = v.horiz ? this.disp[i]! * c : v.lane * c;
    const y = v.horiz ? v.lane * c : this.disp[i]! * c;
    // Above the car, in the empty bay row between it and the wall where there is one.
    el.style.left = `${x + (v.horiz ? v.len * c : c) / 2 - 60}px`;
    el.style.top = `${y - c * 0.85}px`;
    el.style.width = '120px';
    el.style.justifyContent = 'center';
  }

  hideCoach(): void {
    this.coachEl?.remove();
    this.coachEl = null;
    for (const b of this.buttons) b.classList.remove('coach');
  }

  setMoves(n: number, opt: number | null, label: string): void {
    this.movesHud.innerHTML = `${ICONS.tyre}<span>${n}</span>${opt ? `<span class="target">/ ${opt}</span>` : ''}`;
    this.movesHud.setAttribute('aria-label', label);
  }

  setScoops(n: number, label: string, plop = false): void {
    this.scoopsHud.innerHTML = `${ICONS.cone}<span>${n}</span>`;
    this.scoopsHud.setAttribute('aria-label', label);
    if (plop) {
      this.scoopsHud.classList.remove('plop');
      void this.scoopsHud.offsetWidth;
      this.scoopsHud.classList.add('plop');
    }
  }

  destroy(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.tweens.clear();
    this.stage.remove();
  }
}
