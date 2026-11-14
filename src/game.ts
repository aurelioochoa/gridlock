// The game: one lot on screen, its history, and every way a kid can touch it.
//
// Sim and view are separate (design §12): the rules, the solver and the history live in
// src/sim/ and are pure; this file turns pointer drags, keys and gamepad buttons into moves,
// and moves into pictures and sounds.

import lotsData from './data/lots.json';
import { parseBoard, freeRange, blockerOf, vanCanExit, occupancy, type Puzzle, VAN, WALL } from './sim/board';
import { buildGraph, hintFrom, EXIT, type Graph } from './sim/solver';
import { pushMove, pushExit, positionOf, moveCount, undo as undoH, reset as resetH, pack, unpack, type Entry } from './sim/history';
import { PARKS, UNLOCK_SOLVES, starsFor, type ParkKey } from './sim/parks';
import { BoardView, easeIn, easeOut } from './view/board-view';
import { STRIP, ICONS, defsSvg } from './view/art';
import { t, type Key } from './i18n';
import { loadSave, writeSave, recordSolve, type Save } from './save/save';
import * as sfx from './audio/sfx';
import type { HintReply, HintRequest } from './sim/hint-worker';
import { pausePanel, resultPanel, fillStars, mapScreen, type LotInfo } from './ui/panels';

export interface Lot {
  id: string;
  band: ParkKey;
  board: string;
  opt: number;
  movers: number;
  branch: number;
  states: number;
}

export const LOTS: Lot[] = (lotsData as { lots: Lot[] }).lots;

const IDLE_GLOW_MS = 60_000;
const TEACHING = 3;

type Overlay = 'pause' | 'result' | 'map' | null;

interface Drag {
  i: number;
  id: number;
  x0: number;
  y0: number;
  start: number;
  lo: number;
  hi: number;
  /** The van has a clear column: it may be dragged up past the top bay and out. */
  exitable: boolean;
  travel: number;
  vel: number;
  lastT: number;
  lastD: number;
  bumped: -1 | 0 | 1;
}

export class Game {
  save: Save;
  private root: HTMLElement;
  private screen!: HTMLDivElement;
  private toolbar!: HTMLElement;
  private tools: Record<string, HTMLButtonElement> = {};
  private view: BoardView | null = null;
  private lotIndex = 0;
  private p!: Puzzle;
  private history: Entry[] = [];
  private hinted = false;
  private graph: Graph | null = null;
  private overlay: Overlay = null;
  private overlayEl: HTMLElement | null = null;
  private drag: Drag | null = null;
  private ring = 0;
  private held = false;
  private busy = false;
  private wasClear = false;
  private idleTimer = 0;
  private repeat: { key: string; timer: number } | null = null;
  private reducedQuery: MediaQueryList | null = null;
  /** The last hint's round trip, for the smoke harness (design §12). */
  lastHintMs = 0;
  /** The solver for hints runs in a Web Worker (§12); null if the browser refuses one. */
  private worker: Worker | null = null;
  private hintSeq = 0;

  constructor(root: HTMLElement) {
    this.root = root;
    this.save = loadSave();
    sfx.setMuted(this.save.muted);
    try {
      this.reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
      this.reducedQuery.addEventListener?.('change', () => this.applyCalm());
    } catch {
      this.reducedQuery = null;
    }
    root.insertAdjacentHTML('beforeend', defsSvg());
    try {
      this.worker = new Worker(new URL('./sim/hint-worker.ts', import.meta.url), { type: 'module' });
      this.worker.onmessage = (e: MessageEvent<HintReply>) => this.onHint(e.data);
      this.worker.onerror = () => (this.worker = null);
    } catch {
      this.worker = null;
    }
    this.buildScreen();
    this.applyCalm();
    this.bindGlobal();
    this.openLot(this.bootLot(), true);
  }

  // ---- what to show -------------------------------------------------------------------------

  private bootLot(): number {
    const cur = this.save.current;
    if (cur) {
      const k = LOTS.findIndex((l) => l.id === cur.id);
      if (k >= 0 && this.parkOpen(LOTS[k]!.band)) return k;
    }
    return this.nextUnsolved(-1) ?? 0;
  }

  parkOpen(key: ParkKey): boolean {
    const k = PARKS.findIndex((p) => p.key === key);
    if (k <= 0) return true;
    return this.parkOpen(PARKS[k - 1]!.key) && this.solvedIn(PARKS[k - 1]!.key) >= UNLOCK_SOLVES;
  }

  solvedIn(key: ParkKey): number {
    return LOTS.filter((l) => l.band === key && this.save.lots[l.id]).length;
  }

  /** The next open lot after `from` that is not solved yet, in list order. */
  private nextUnsolved(from: number): number | null {
    for (let k = from + 1; k < LOTS.length; k++) {
      const l = LOTS[k]!;
      if (this.parkOpen(l.band) && !this.save.lots[l.id]) return k;
    }
    for (let k = 0; k <= from; k++) {
      const l = LOTS[k]!;
      if (this.parkOpen(l.band) && !this.save.lots[l.id]) return k;
    }
    return null;
  }

  private nextLot(from: number): number | null {
    const k = from + 1;
    if (k < LOTS.length && this.parkOpen(LOTS[k]!.band)) return k;
    return this.nextUnsolved(from);
  }

  private lotNumber(k: number): number {
    const band = LOTS[k]!.band;
    return LOTS.slice(0, k + 1).filter((l) => l.band === band).length;
  }

  private get calm(): boolean {
    return this.save.reducedMotion ?? this.reducedQuery?.matches ?? false;
  }

  private applyCalm(): void {
    document.documentElement.classList.toggle('calm', this.calm);
  }

  private persist(): void {
    writeSave(this.save);
  }

  // ---- the screen ---------------------------------------------------------------------------

  private buildScreen(): void {
    this.screen = document.createElement('div');
    this.screen.className = 'screen';
    this.toolbar = document.createElement('nav');
    this.toolbar.className = 'toolbar';
    const add = (name: string, icon: string, label: Key, fn: () => void) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tool';
      b.dataset.tool = name;
      b.innerHTML = icon;
      b.setAttribute('aria-label', t(label));
      b.addEventListener('click', () => {
        sfx.unlock();
        fn();
      });
      this.tools[name] = b;
      this.toolbar.append(b);
    };
    add('undo', ICONS.undo, 'tool.undo', () => this.undo());
    add('reset', ICONS.reset, 'tool.reset', () => this.reset());
    add('hint', ICONS.hint, 'tool.hint', () => this.hint());
    add('map', ICONS.map, 'tool.map', () => this.openMap());
    add('sound', this.save.muted ? ICONS.soundOff : ICONS.soundOn, 'tool.sound', () => this.toggleMute());
    add('pause', ICONS.pause, 'tool.pause', () => this.openPause());
    this.tools.sound!.setAttribute('aria-pressed', String(!this.save.muted));
    this.screen.append(this.toolbar);
    this.root.append(this.screen);
    window.addEventListener('resize', () => this.layout());
  }

  private layout(): void {
    if (!this.view) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const n = this.p.size;
    const landscape = W > H * 1.05;
    this.screen.classList.toggle('landscape', landscape);
    this.screen.classList.toggle('portrait', !landscape);
    const pad = 16;
    let availW: number;
    let availH: number;
    if (landscape) {
      availW = W - pad * 2 - 56 - 16;
      availH = H - pad * 2;
    } else {
      const perRow = Math.max(1, Math.floor((W - pad * 2 + 4) / 60));
      const rows = Math.ceil(6 / perRow);
      availW = W - pad * 2;
      availH = H - pad * 2 - rows * 60 - 12;
    }
    // Bays ≥ 48 px on a 320 px phone (6×6, 16 px gutters), capped at 96 px (design §10).
    const cell = Math.max(40, Math.min(96, Math.floor(Math.min(availW / n, availH / (n + STRIP)))));
    this.view.layout(cell);
  }

  // ---- a lot --------------------------------------------------------------------------------

  openLot(k: number, boot = false): void {
    this.closeOverlay();
    this.view?.destroy();
    this.lotIndex = k;
    const lot = LOTS[k]!;
    this.p = parseBoard(lot.board);
    this.graph = null;
    this.history = [];
    this.hinted = false;
    this.held = false;
    this.busy = false;
    const cur = this.save.current;
    if (cur && cur.id === lot.id) {
      const h = unpack(this.p, cur.history);
      if (h) {
        this.history = h;
        this.hinted = cur.hinted;
      }
    }
    const pos = positionOf(this.p, this.history);
    const view = new BoardView(this.p, lot.band, pos);
    this.view = view;
    view.stage.setAttribute('aria-label', t('board.label', { park: t(`park.${lot.band}`), n: this.lotNumber(k) }));
    this.screen.insertBefore(view.stage, this.toolbar);
    view.buttons.forEach((b, i) => this.bindVehicle(b, i));
    view.layer.querySelectorAll('.planter').forEach((d) => d.setAttribute('aria-label', t('v.planter')));
    this.layout();
    this.wasClear = vanCanExit(this.p, pos);
    this.refresh();
    // The ring starts on the van, or in the teaching lots on the vehicle that must move first.
    this.ring = k < TEACHING && this.history.length === 0 ? (this.firstMover() ?? VAN) : VAN;
    this.syncRing(false);
    if (k === 0 && !this.save.seen.includes('coach') && this.history.length === 0) {
      view.showCoach(this.ring, document.body.classList.contains('kbd') || !matchMediaSafe('(pointer: coarse)'));
    }
    this.save.current = { id: lot.id, history: pack(this.history), hinted: this.hinted };
    this.persist();
    this.armIdle();
    // Solve the whole lot in the background now, so a hint is instant when it is wanted.
    this.post({ kind: 'prepare', board: lot.board });
    if (boot) this.root.dataset.ready = '1';
    this.root.dataset.lot = String(k);
  }

  /** For the smoke harness (`?debug=1`): the shortest way on from where the board stands. */
  debugSolution(): { v: number; to: number }[] {
    const g = this.ensureGraph();
    const out: { v: number; to: number }[] = [];
    const pos = this.pos;
    for (;;) {
      const m = hintFrom(g, pos);
      if (!m) return out;
      out.push(m);
      if (m.to === EXIT) return out;
      pos[m.v] = m.to;
    }
  }

  debugState(): { lot: number; pos: number[]; moves: number; overlay: string | null; held: boolean; ring: number; size: number; horiz: boolean[]; lanes: number[] } {
    return {
      lot: this.lotIndex, pos: this.pos, moves: moveCount(this.history), overlay: this.overlay, held: this.held, ring: this.ring,
      size: this.p.size, horiz: this.p.vehicles.map((v) => v.horiz), lanes: this.p.vehicles.map((v) => v.lane),
    };
  }

  private firstMover(): number | null {
    const g = this.ensureGraph();
    const m = hintFrom(g, positionOf(this.p, this.history));
    return m ? m.v : null;
  }

  /** Main-thread solver: only for the tiny teaching lots and as the no-worker fallback. */
  private ensureGraph(): Graph {
    if (!this.graph) this.graph = buildGraph(this.p, this.p.start)!;
    return this.graph;
  }

  private get pos(): number[] {
    return positionOf(this.p, this.history);
  }

  /** Counter, accessible names, the van's "path clear" state. */
  private refresh(): void {
    const view = this.view!;
    const lot = LOTS[this.lotIndex]!;
    const n = moveCount(this.history);
    const solved = this.save.lots[lot.id];
    view.setMoves(n, solved ? lot.opt : null, t('hud.moves', { n }) + (solved ? `, ${t('hud.shortest', { n: lot.opt })}` : ''));
    const scoops = Object.keys(this.save.lots).length;
    view.setScoops(scoops, t('hud.scoops', { n: scoops }));
    const pos = this.pos;
    this.p.vehicles.forEach((v, i) => {
      const row = (v.horiz ? v.lane : pos[i]!) + 1;
      const col = (v.horiz ? pos[i]! : v.lane) + 1;
      const name = t(i === 0 ? 'v.van' : (`v.${view.looks[i]!.kind}` as Key));
      let label = t('v.label', { name, row, col, dir: t(v.horiz ? 'v.lr' : 'v.ud') });
      if (this.held && i === this.ring) label += `, ${t('v.held')}`;
      view.buttons[i]!.setAttribute('aria-label', label);
    });
    const clear = vanCanExit(this.p, pos);
    view.buttons[VAN]!.classList.toggle('clear', clear);
    if (clear && !this.wasClear) {
      // A clear path: the van hops and its bell plays — never sound alone (design §D).
      if (!this.calm) view.fx(VAN, 'hop');
      else view.fx(VAN, 'ringbump');
      sfx.bell();
    }
    this.wasClear = clear;
    this.tools.undo!.disabled = this.history.length === 0;
  }

  /** A move happened: record it, save it, clear the ghost and the coach. */
  private commit(i: number, from: number, to: number): void {
    if (from === to) return;
    this.history = pushMove(this.history, i, from, to);
    sfx.roll(Math.abs(to - from));
    this.afterChange();
    if (this.lotIndex === 0 && !this.save.seen.includes('coach')) {
      this.save.seen = [...this.save.seen, 'coach'];
      this.view!.hideCoach();
    }
  }

  private afterChange(): void {
    this.hintSeq++;
    this.view!.clearGhost();
    this.save.current = { id: LOTS[this.lotIndex]!.id, history: pack(this.history), hinted: this.hinted };
    this.persist();
    this.refresh();
    this.armIdle();
  }

  private exitVan(): void {
    const h = pushExit(this.p, this.history);
    if (!h || this.busy) return;
    this.busy = true;
    this.held = false;
    this.view!.buttons[VAN]!.classList.remove('held');
    this.history = h;
    this.view!.clearGhost();
    this.view!.hideCoach();
    sfx.jingle();
    const lot = LOTS[this.lotIndex]!;
    const moves = moveCount(this.history);
    const stars = starsFor(moves, lot.opt, this.hinted);
    this.view!.animate(VAN, -(STRIP + 2.4), this.calm ? 200 : 700, easeIn, () => {
      this.save = recordSolve(this.save, lot.id, stars, moves);
      this.persist();
      sfx.plop();
      const scoops = Object.keys(this.save.lots).length;
      this.view!.setScoops(scoops, t('hud.scoops', { n: scoops }), true);
      this.showResult(stars, moves, this.save.lots[lot.id]!.best);
    });
  }

  // ---- valves: undo, reset, hint ------------------------------------------------------------

  undo(): void {
    if (this.busy || this.overlay || !this.history.length) return;
    this.putDown();
    const before = this.pos;
    this.history = undoH(this.history);
    this.animateTo(before, this.pos);
    this.afterChange();
    sfx.tick();
  }

  reset(): void {
    if (this.busy || this.overlay) return;
    this.putDown();
    const before = this.pos;
    const h = resetH(this.p, this.history);
    if (h.length === this.history.length) return;
    this.history = h;
    this.animateTo(before, this.pos);
    this.afterChange();
    sfx.tick();
  }

  private animateTo(before: number[], after: number[]): void {
    after.forEach((o, i) => {
      if (o !== before[i]) this.view!.animate(i, o, this.calm ? 60 : 160);
    });
  }

  hint(): void {
    if (this.busy || this.overlay) return;
    this.putDown();
    this.hintT0 = performance.now();
    const seq = ++this.hintSeq;
    const pos = this.pos;
    if (this.worker) {
      this.post({ kind: 'hint', board: LOTS[this.lotIndex]!.board, pos, seq });
    } else {
      // No worker (very old browser or a refused frame): solve here, the slow way.
      this.onHint({ kind: 'hint', seq, move: hintFrom(this.ensureGraph(), pos) });
    }
  }

  private hintT0 = 0;

  private post(msg: HintRequest): void {
    try {
      this.worker?.postMessage(msg);
    } catch {
      this.worker = null;
    }
  }

  private onHint(reply: HintReply): void {
    // A stale answer (the kid moved, or changed lot, while it was computed) is dropped.
    if (reply.seq !== this.hintSeq || this.busy || this.overlay) return;
    this.lastHintMs = performance.now() - this.hintT0;
    const m = reply.move;
    if (!m) return;
    this.hinted = true;
    this.save.current = { id: LOTS[this.lotIndex]!.id, history: pack(this.history), hinted: true };
    this.persist();
    this.view!.showGhost(m.v, m.to === EXIT ? 'exit' : m.to);
    this.view!.fx(m.v, 'wiggle');
    sfx.sparkle();
    this.ring = m.v;
    this.syncRing(document.body.classList.contains('kbd'));
    this.tools.hint!.classList.remove('glow');
  }

  private armIdle(): void {
    window.clearTimeout(this.idleTimer);
    this.tools.hint?.classList.remove('glow');
    // After a minute with no move the bulb glows: an offer that never plays itself (§8).
    this.idleTimer = window.setTimeout(() => this.tools.hint?.classList.add('glow'), IDLE_GLOW_MS);
  }

  toggleMute(): void {
    this.save.muted = !this.save.muted;
    sfx.setMuted(this.save.muted);
    this.tools.sound!.innerHTML = this.save.muted ? ICONS.soundOff : ICONS.soundOn;
    this.tools.sound!.setAttribute('aria-pressed', String(!this.save.muted));
    this.persist();
    if (this.overlay === 'pause') this.openPause(true);
  }

  // ---- pointer -------------------------------------------------------------------------------

  private bindVehicle(b: HTMLButtonElement, i: number): void {
    b.addEventListener('pointerdown', (e) => this.onDown(e, i));
    b.addEventListener('pointermove', (e) => this.onMove(e));
    b.addEventListener('pointerup', (e) => this.onUp(e));
    b.addEventListener('pointercancel', (e) => this.onUp(e, true));
    b.addEventListener('lostpointercapture', (e) => this.onUp(e, true));
    b.addEventListener('focus', () => {
      if (this.ring !== i) {
        this.putDown();
        this.ring = i;
      }
    });
    // Enter/Space on a focused vehicle are handled in onKey; a synthetic click must not double them.
    b.addEventListener('click', (e) => e.preventDefault());
  }

  private onDown(e: PointerEvent, i: number): void {
    if (this.busy || this.overlay || this.drag) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.preventDefault();
    sfx.unlock();
    document.body.classList.remove('kbd');
    this.putDown();
    const view = this.view!;
    view.settle(i);
    const pos = this.pos;
    const [lo, hi] = freeRange(this.p, pos, i);
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // Synthetic pointers can lack a capturable id; the drag still works without capture.
    }
    this.drag = {
      i, id: e.pointerId, x0: e.clientX, y0: e.clientY, start: pos[i]!, lo, hi,
      exitable: i === VAN && lo === 0, travel: 0, vel: 0, lastT: e.timeStamp, lastD: pos[i]!, bumped: 0,
    };
    this.ring = i;
    view.buttons[i]!.classList.add('dragging');
    view.buttons[i]!.focus({ preventScroll: true });
  }

  private onMove(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const view = this.view!;
    const v = this.p.vehicles[d.i]!;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    d.travel = Math.max(d.travel, Math.hypot(dx, dy));
    // The vehicle follows the finger along its own axis only; a sideways drag does nothing.
    const raw = d.start + (v.horiz ? dx : dy) / view.cell;
    const lo = d.exitable ? -(STRIP + 0.5) : d.lo;
    const disp = Math.min(d.hi, Math.max(lo, raw));
    const dt = Math.max(1, e.timeStamp - d.lastT);
    d.vel = d.vel * 0.6 + ((disp - d.lastD) / dt) * 0.4;
    d.lastT = e.timeStamp;
    d.lastD = disp;
    view.disp[d.i] = disp;
    // At its limit it squashes, and whatever blocked it meeps and shivers (§4, §7a).
    const over = raw < lo - 0.12 ? -1 : raw > d.hi + 0.12 ? 1 : 0;
    view.place(d.i, over && !this.calm ? 0.96 : 1);
    if (over && d.bumped !== over) this.bump(d.i, over === -1 ? d.lo : d.hi, over as -1 | 1);
    d.bumped = over;
  }

  private onUp(e: PointerEvent, cancelled = false): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    const view = this.view!;
    view.buttons[d.i]!.classList.remove('dragging');
    view.place(d.i);
    if (d.travel < 6 && !cancelled) {
      // A tap without travel wiggles it along its axis: a wordless "this way".
      view.disp[d.i] = d.start;
      view.place(d.i);
      view.fx(d.i, 'wiggle');
      return;
    }
    const disp = view.disp[d.i]!;
    // Released, it projects ~100 ms of velocity and snaps to the nearest bay (§7a).
    const projected = disp + d.vel * 100;
    if (d.exitable && !cancelled && (disp < d.start - 0.25 || (d.vel < -0.002 && projected < d.start - 0.25))) {
      // One generous rule: a van released moving up a clear path carries on out.
      if (d.start !== 0) this.history = pushMove(this.history, VAN, d.start, 0);
      this.exitVan();
      return;
    }
    const target = Math.min(d.hi, Math.max(d.lo, Math.round(projected)));
    view.animate(d.i, target, this.calm ? 60 : 90, easeOut, () => {
      if (target !== d.start) sfx.bop();
    });
    this.commit(d.i, d.start, target);
  }

  /** A refused slide: squash, meep pitched by size, and the blocker shivers. */
  private bump(i: number, off: number, dir: -1 | 1): void {
    const view = this.view!;
    const pos = this.pos;
    pos[i] = off;
    if (!this.calm) view.fx(i, 'squash');
    sfx.meep(this.p.vehicles[i]!.len);
    const who = blockerOf(this.p, pos, i, off, dir, occupancy(this.p, pos));
    // A planter or the kerb cannot shiver; the squash and the meep still say "blocked".
    if (who !== null && who !== WALL) view.fx(who, 'shiver');
  }

  // ---- keyboard -------------------------------------------------------------------------------

  private bindGlobal(): void {
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => {
      if (this.repeat && e.key === this.repeat.key) this.stopRepeat();
    });
    window.addEventListener('pointerdown', () => {
      sfx.unlock();
      document.body.classList.remove('kbd');
    }, true);
    window.addEventListener('blur', () => this.stopRepeat());
    document.addEventListener('visibilitychange', () => {
      document.documentElement.classList.toggle('tab-hidden', document.hidden);
      sfx.setHidden(document.hidden);
    });
    window.addEventListener('gamepadconnected', () => this.pollPad());
  }

  private stopRepeat(): void {
    if (this.repeat) window.clearInterval(this.repeat.timer);
    this.repeat = null;
  }

  onKey(e: KeyboardEvent | { key: string; shiftKey?: boolean; repeat?: boolean; preventDefault?: () => void; synthetic?: boolean }): void {
    const key = e.key;
    const prevent = () => e.preventDefault?.();
    sfx.unlock();
    if (key !== 'Shift' && key !== 'Control' && key !== 'Alt' && key !== 'Meta') document.body.classList.add('kbd');

    if (this.overlay) {
      this.overlayKey(e, prevent);
      return;
    }
    if (this.busy) {
      if (key.startsWith('Arrow') || key === ' ' || key === 'Tab') prevent();
      return;
    }
    const active = document.activeElement as HTMLElement | null;
    const inToolbar = !!active && this.toolbar.contains(active);
    const lower = key.length === 1 ? key.toLowerCase() : key;

    // Anywhere on the play screen.
    switch (lower) {
      case 'z':
      case 'Backspace':
        prevent();
        this.undo();
        return;
      case 'r':
        prevent();
        this.reset();
        return;
      case 'h':
        prevent();
        this.hint();
        return;
      case 'p':
        prevent();
        this.openPause();
        return;
      case 'm':
        prevent();
        this.toggleMute();
        return;
    }
    if (key === 'Tab') {
      prevent();
      this.tabStep(e.shiftKey ? -1 : 1);
      return;
    }
    if (inToolbar) {
      if (key.startsWith('Arrow')) {
        prevent();
        const list = this.toolList();
        const k = list.indexOf(active as HTMLButtonElement);
        const step = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
        list[(k + step + list.length) % list.length]!.focus();
      } else if (key === 'Escape') {
        prevent();
        this.syncRing(true);
      } else if ((key === 'Enter' || key === ' ') && 'synthetic' in e) {
        (active as HTMLButtonElement).click();
      }
      return;
    }

    if (this.held) {
      this.heldKey(key, e.repeat ?? false, prevent);
      return;
    }
    // Browse.
    if (key.startsWith('Arrow')) {
      prevent();
      this.browse(key);
    } else if (key === 'Enter' || key === ' ') {
      prevent();
      if (!e.repeat) this.pickUp();
    } else if (key === 'Escape') {
      prevent();
      this.openPause();
    }
  }

  private toolList(): HTMLButtonElement[] {
    return Object.values(this.tools).filter((b) => !b.disabled);
  }

  /** Tab order: vehicles in reading order of their top-left bay, then the toolbar (§10). */
  private tabStep(dir: 1 | -1): void {
    const pos = this.pos;
    const order = this.p.vehicles
      .map((v, i) => ({ i, at: (v.horiz ? v.lane : pos[i]!) * 10 + (v.horiz ? pos[i]! : v.lane) }))
      .sort((a, b) => a.at - b.at)
      .map((x) => x.i);
    const stops: (number | HTMLButtonElement)[] = [...order, ...this.toolList()];
    const active = document.activeElement;
    let k = stops.findIndex((s) => (typeof s === 'number' ? this.view!.buttons[s] === active : s === active));
    if (k < 0) k = stops.indexOf(this.ring);
    this.putDown();
    const next = stops[(k + dir + stops.length) % stops.length]!;
    if (typeof next === 'number') {
      this.ring = next;
      this.syncRing(true);
    } else {
      next.focus();
    }
  }

  private syncRing(focus: boolean): void {
    const b = this.view?.buttons[this.ring];
    if (!b) return;
    this.view!.buttons.forEach((x, i) => (x.tabIndex = i === this.ring ? 0 : -1));
    // Never pull focus into a frame the kid has not focused: browsers refuse it (and log it).
    if (!document.hasFocus()) return;
    if (focus || !document.activeElement || document.activeElement === document.body) b.focus({ preventScroll: true });
  }

  /** Move the ring to the nearest vehicle further that way: along + 2 × sideways (§10). */
  private browse(key: string): void {
    const pos = this.pos;
    const centre = (i: number) => {
      const v = this.p.vehicles[i]!;
      const x = v.horiz ? pos[i]! + v.len / 2 : v.lane + 0.5;
      const y = v.horiz ? v.lane + 0.5 : pos[i]! + v.len / 2;
      return [x, y] as const;
    };
    const [cx, cy] = centre(this.ring);
    const [ax, ay] = key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : key === 'ArrowUp' ? [0, -1] : [0, 1];
    let best = -1;
    let bestScore = Infinity;
    for (let i = 0; i < this.p.vehicles.length; i++) {
      if (i === this.ring) continue;
      const [x, y] = centre(i);
      const along = (x - cx) * ax + (y - cy) * ay;
      if (along <= 0.01) continue;
      const side = Math.abs((x - cx) * ay) + Math.abs((y - cy) * ax);
      const score = along + 2 * side;
      if (score < bestScore) {
        bestScore = score;
        best = i;
      }
    }
    if (best < 0) {
      this.view!.fx(this.ring, 'ringbump');
      return;
    }
    this.ring = best;
    this.syncRing(true);
    sfx.tick();
  }

  private pickUp(): void {
    this.held = true;
    const b = this.view!.buttons[this.ring]!;
    b.classList.add('held');
    this.updateHeldChevrons();
    this.refresh();
    sfx.tick();
  }

  private putDown(): void {
    if (!this.held) return;
    this.held = false;
    this.stopRepeat();
    this.view?.buttons.forEach((b) => b.classList.remove('held'));
    this.refresh();
  }

  private updateHeldChevrons(): void {
    const i = this.ring;
    const pos = this.pos;
    const [lo, hi] = freeRange(this.p, pos, i);
    const vanOut = i === VAN && lo === 0;
    this.view!.setChevrons(i, lo < pos[i]! || vanOut, hi > pos[i]!);
  }

  private heldKey(key: string, isRepeat: boolean, prevent: () => void): void {
    if (key === 'Enter' || key === ' ' || key === 'Escape') {
      prevent();
      this.putDown();
      sfx.tick();
      return;
    }
    if (!key.startsWith('Arrow')) return;
    prevent();
    // Keyboard slides repeat every 150 ms while held — our own timer, not the OS key repeat.
    if (isRepeat) return;
    this.slideStep(key);
    this.stopRepeat();
    this.repeat = { key, timer: window.setInterval(() => this.slideStep(key), 150) };
  }

  private slideStep(key: string): void {
    if (!this.held || this.busy) return this.stopRepeat();
    const i = this.ring;
    const v = this.p.vehicles[i]!;
    const along = v.horiz ? key === 'ArrowLeft' || key === 'ArrowRight' : key === 'ArrowUp' || key === 'ArrowDown';
    if (!along) {
      // Across its axis: "I don't go that way", still held.
      this.view!.fx(i, 'wiggle');
      this.stopRepeat();
      return;
    }
    const dir: -1 | 1 = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const pos = this.pos;
    const [lo, hi] = freeRange(this.p, pos, i);
    if (i === VAN && dir === -1 && lo === 0) {
      this.stopRepeat();
      this.exitVan();
      return;
    }
    const to = pos[i]! + dir;
    if (to < lo || to > hi) {
      this.stopRepeat();
      this.bump(i, pos[i]!, dir);
      return;
    }
    this.view!.settle(i);
    this.view!.animate(i, to, this.calm ? 60 : 110, easeOut);
    this.commit(i, pos[i]!, to);
    sfx.bop();
    this.updateHeldChevrons();
  }

  // ---- gamepad: d-pad, A, B, Start (§10) --------------------------------------------------------

  private padLoop = 0;
  private padPrev: boolean[] = [];

  private pollPad(): void {
    if (this.padLoop) return;
    const map: Record<number, string> = { 12: 'ArrowUp', 13: 'ArrowDown', 14: 'ArrowLeft', 15: 'ArrowRight', 0: 'Enter', 1: 'Escape', 9: 'p' };
    const step = () => {
      const pads = navigator.getGamepads?.() ?? [];
      const pad = [...pads].find((p) => p);
      if (!pad) {
        this.padLoop = 0;
        return;
      }
      for (const [idx, key] of Object.entries(map)) {
        const k = Number(idx);
        const down = !!pad.buttons[k]?.pressed;
        if (down && !this.padPrev[k]) this.onKey({ key, synthetic: true });
        if (!down && this.padPrev[k] && this.repeat?.key === key) this.stopRepeat();
        this.padPrev[k] = down;
      }
      this.padLoop = requestAnimationFrame(step);
    };
    this.padLoop = requestAnimationFrame(step);
  }

  // ---- overlays --------------------------------------------------------------------------------

  private overlayKey(e: { key: string; shiftKey?: boolean; synthetic?: boolean }, prevent: () => void): void {
    const el = this.overlayEl;
    if (!el) return;
    const items = [...el.querySelectorAll<HTMLButtonElement>('button:not([hidden])')];
    const active = document.activeElement as HTMLButtonElement | null;
    const k = active ? items.indexOf(active) : -1;
    const key = e.key;
    if (key === 'Escape' || (key === 'p' && this.overlay === 'pause') || (key === 'm' && this.overlay === 'pause')) {
      prevent();
      if (key === 'm') return this.toggleMute();
      if (this.overlay === 'pause') this.closeOverlay();
      else if (this.overlay === 'map') this.closeMap();
      else if (this.overlay === 'result') this.openMap();
      return;
    }
    if (key === 'm' || key === 'M') {
      prevent();
      this.toggleMute();
      return;
    }
    if (key === 'Tab' || key.startsWith('Arrow')) {
      prevent();
      if (!items.length) return;
      if (this.overlay === 'map' && key.startsWith('Arrow') && active && k >= 0) {
        const next = nearestInDirection(items, active, key);
        if (next) next.focus();
        next?.scrollIntoView?.({ block: 'nearest' });
        return;
      }
      const back = key === 'ArrowLeft' || key === 'ArrowUp' || (key === 'Tab' && e.shiftKey);
      items[(k + (back ? -1 : 1) + items.length) % items.length]!.focus();
      return;
    }
    if ((key === 'Enter' || key === ' ') && e.synthetic && active && k >= 0) active.click();
  }

  private mountOverlay(kind: Overlay, el: HTMLElement, focus?: HTMLElement | null): void {
    this.overlayEl?.remove();
    this.overlay = kind;
    this.overlayEl = el;
    this.root.append(el);
    if (document.hasFocus()) (focus ?? el.querySelector<HTMLButtonElement>('button:not([hidden])'))?.focus({ preventScroll: true });
    this.root.dataset.overlay = kind ?? '';
  }

  closeOverlay(): void {
    this.overlayEl?.remove();
    this.overlayEl = null;
    this.overlay = null;
    this.root.dataset.overlay = '';
    if (this.view) this.syncRing(true);
  }

  openPause(refocus = false): void {
    if (this.busy) return;
    this.putDown();
    const which = refocus ? (document.activeElement as HTMLElement | null)?.dataset.which : undefined;
    const el = pausePanel({
      muted: this.save.muted,
      calm: this.calm,
      onResume: () => this.closeOverlay(),
      onMap: () => this.openMap(),
      onSound: () => this.toggleMute(),
      onCalm: () => {
        this.save.reducedMotion = !this.calm;
        this.persist();
        this.applyCalm();
        this.openPause(true);
      },
    });
    const btns = el.querySelectorAll<HTMLButtonElement>('button');
    ['resume', 'map', 'sound', 'calm'].forEach((w, k) => btns[k] && (btns[k].dataset.which = w));
    this.mountOverlay('pause', el, which ? el.querySelector<HTMLElement>(`[data-which="${which}"]`) : null);
    sfx.tick();
  }

  private showResult(stars: number, moves: number, best: number): void {
    const next = this.nextLot(this.lotIndex);
    const el = resultPanel({
      stars, moves, best, hasNext: next !== null,
      onNext: () => next !== null && this.openLot(next),
      onReplay: () => this.openLot(this.lotIndex),
      onMap: () => this.openMap(),
    });
    this.mountOverlay('result', el);
    fillStars(el, stars, this.calm, (k) => sfx.chime(k));
    this.root.dataset.solved = String((Number(this.root.dataset.solved) || 0) + 1);
  }

  openMap(): void {
    if (this.busy && this.overlay !== 'result') return;
    this.putDown();
    const lots: LotInfo[] = LOTS.map((l, k) => ({ id: l.id, band: l.band, n: this.lotNumber(k), stars: this.save.lots[l.id]?.stars ?? 0 }));
    const cur = LOTS[this.lotIndex]!.id;
    const el = mapScreen({
      lots,
      open: (k) => this.parkOpen(k),
      solvedIn: (k) => this.solvedIn(k),
      currentId: cur,
      onPick: (id) => {
        sfx.tick();
        const k = LOTS.findIndex((l) => l.id === id);
        if (k === this.lotIndex && !this.busy) this.closeOverlay();
        else this.openLot(k);
      },
      onBack: () => this.closeMap(),
    });
    this.mountOverlay('map', el, el.querySelector<HTMLElement>(`.lot[data-id="${cur}"]`) ?? el.querySelector<HTMLElement>('.lot'));
    el.querySelector('.lot.current')?.scrollIntoView?.({ block: 'center' });
  }

  private closeMap(): void {
    // Back from the map: to the board in progress, or, after a solve, on to the next lot.
    if (this.busy) {
      const next = this.nextLot(this.lotIndex);
      this.openLot(next ?? this.lotIndex);
    } else this.closeOverlay();
  }
}

function nearestInDirection(items: HTMLElement[], from: HTMLElement, key: string): HTMLElement | null {
  const r = from.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  const [ax, ay] = key === 'ArrowLeft' ? [-1, 0] : key === 'ArrowRight' ? [1, 0] : key === 'ArrowUp' ? [0, -1] : [0, 1];
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const it of items) {
    if (it === from) continue;
    const q = it.getBoundingClientRect();
    const x = q.left + q.width / 2 - cx;
    const y = q.top + q.height / 2 - cy;
    const along = x * ax + y * ay;
    if (along <= 1) continue;
    const score = along + 2 * (Math.abs(x * ay) + Math.abs(y * ax));
    if (score < bestScore) {
      bestScore = score;
      best = it;
    }
  }
  return best;
}

function matchMediaSafe(q: string): boolean {
  try {
    return window.matchMedia(q).matches;
  } catch {
    return false;
  }
}
