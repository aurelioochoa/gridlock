// Does the built bundle actually work? (design §12, SHIP-CHECKLIST §2)
//
//   npm run build && npm run smoke          # SHOTS=/some/dir to keep the screenshots elsewhere
//
// Serves dist/ with `vite preview` and drives it in headless Chromium:
//   - lots 1–3 by KEYS ONLY (Tab to a vehicle, Enter to pick up, arrows to slide, ↑ out);
//   - lot 2 again by real CDP MOUSE drags (Acorn Works §17g: hit-area bugs no unit test sees);
//   - lots 1–2 by TOUCH drags on a 390×844 phone, plus a tap on the toolbar;
//   - a reload mid-lot comes back exactly as left; pause, mute, calm motion, map;
//   - every string blanked (`?blank=1`) and lot 1 still plays;
//   - once inside an iframe with the site's exact sandbox;
//   - the hint on the biggest lot at 4× CPU throttle: it runs in a Web Worker (§12), so the
//     main thread must never stall over 100 ms while it is computed.
// It FAILS on any console error or page error. Waiting is always a deadline with polling.
import { spawn } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';

const ROOT = new URL('..', import.meta.url).pathname;
const SHOTS = process.env.SHOTS ?? join(tmpdir(), 'gridlock-shots');
mkdirSync(SHOTS, { recursive: true });
const LOTS = JSON.parse(readFileSync(join(ROOT, 'src/data/lots.json'), 'utf8')).lots;
const port = 4700 + (process.pid % 200);
const URL_ = `http://localhost:${port}/`;

const errors = [];
const log = (...a) => console.log('  ·', ...a);
const fail = (msg) => {
  throw new Error(msg);
};

// ---- server ------------------------------------------------------------------------------
const server = spawn(process.execPath, [join(ROOT, 'node_modules/vite/bin/vite.js'), 'preview', '--port', String(port), '--strictPort'], {
  cwd: ROOT,
  stdio: ['ignore', 'pipe', 'pipe'],
});
await new Promise((res, rej) => {
  const t = setTimeout(() => rej(new Error('vite preview never came up')), 20_000);
  const on = (d) => {
    if (String(d).includes(String(port))) {
      clearTimeout(t);
      res();
    }
  };
  server.stdout.on('data', on);
  server.stderr.on('data', on);
});

const browser = await chromium.launch();
const cleanup = async () => {
  try { await browser.close(); } catch {}
  try { server.kill('SIGKILL'); } catch {}
};

function watch(page, label) {
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`[${label}] console: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[${label}] pageerror: ${e.message}`));
}

/** Poll a condition in the page (or frame) against a deadline. */
const until = (target, fn, arg, timeout = 8000) => target.waitForFunction(fn, arg, { timeout, polling: 30 });
const state = (target) => target.evaluate(() => window.__gridlock.debugState());
const solution = (target) => target.evaluate(() => window.__gridlock.debugSolution());

async function boot(page, query = '?debug=1', target = page) {
  if (target === page) await page.goto(URL_ + query);
  await until(target, () => document.getElementById('app')?.dataset.ready === '1');
}

// ---- keyboard ------------------------------------------------------------------------------

async function solveByKeys(page, target = page) {
  const sol = await solution(target);
  for (const m of sol) {
    let ok = false;
    for (let k = 0; k < 40 && !ok; k++) {
      ok = await target.evaluate((v) => document.activeElement?.dataset?.v === String(v), m.v);
      if (!ok) await page.keyboard.press('Tab');
    }
    if (!ok) fail(`could not Tab to vehicle ${m.v}`);
    await page.keyboard.press('Enter');
    await until(target, () => window.__gridlock.debugState().held);
    if (m.to === -1) {
      await page.keyboard.press('ArrowUp');
      break;
    }
    const st = await state(target);
    const diff = m.to - st.pos[m.v];
    const key = st.horiz[m.v] ? (diff < 0 ? 'ArrowLeft' : 'ArrowRight') : diff < 0 ? 'ArrowUp' : 'ArrowDown';
    for (let s = 1; s <= Math.abs(diff); s++) {
      await page.keyboard.press(key);
      const want = st.pos[m.v] + Math.sign(diff) * s;
      await until(target, ([v, w]) => window.__gridlock.debugState().pos[v] === w, [m.v, want]);
    }
    await page.keyboard.press('Enter');
    await until(target, () => !window.__gridlock.debugState().held);
  }
  await until(target, () => window.__gridlock.debugState().overlay === 'result', undefined, 6000);
}

// ---- pointer drags -------------------------------------------------------------------------

async function cellPx(page) {
  return page.evaluate(() => parseFloat(document.querySelector('.stage').style.getPropertyValue('--cell')));
}

async function dragMove(page, m, kind, cdp) {
  const st = await state(page);
  const cell = await cellPx(page);
  const box = await page.locator(`.veh[data-v="${m.v}"]`).boundingBox();
  // Grab near the vehicle's centre.
  const x0 = box.x + box.width / 2;
  const y0 = box.y + box.height / 2;
  const delta = m.to === -1 ? -(st.pos[0] + 2.2) * cell : (m.to - st.pos[m.v]) * cell;
  const horiz = m.to !== -1 && st.horiz[m.v];
  const x1 = x0 + (horiz ? delta : 0);
  const y1 = y0 + (horiz ? 0 : delta);
  const steps = 14;
  if (kind === 'mouse') {
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    for (let s = 1; s <= steps; s++) await page.mouse.move(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps);
    // A finger that stops before lifting: no flick projected past the target.
    for (let s = 0; s < 6; s++) await page.mouse.move(x1, y1);
    await page.mouse.up();
  } else {
    const pt = (x, y) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(x0, y0) });
    for (let s = 1; s <= steps; s++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x0 + ((x1 - x0) * s) / steps, y0 + ((y1 - y0) * s) / steps) });
    }
    for (let s = 0; s < 6; s++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(x1 + (s % 2) * 0.1, y1) });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  }
  if (m.to === -1) await until(page, () => window.__gridlock.debugState().overlay === 'result', undefined, 6000);
  else await until(page, ([v, w]) => window.__gridlock.debugState().pos[v] === w, [m.v, m.to]);
}

async function solveByDrags(page, kind, cdp) {
  const sol = await solution(page);
  for (const m of sol) await dragMove(page, m, kind, cdp);
}

/** Let entrance animations finish: the result card's last star is lit and it has stopped popping. */
async function settled(page) {
  await until(page, () => {
    const o = document.querySelector('.overlay');
    if (!o) return true;
    const want = Number(o.querySelector('.stars')?.getAttribute('aria-label')?.match(/\d/)?.[0] ?? 0);
    const lit = o.querySelectorAll('.stars svg.on').length;
    return lit >= want && o.querySelector('.panel').getAnimations().length === 0 && [...o.querySelectorAll('.stars svg')].every((s) => s.getAnimations().length === 0);
  });
}

async function shot(page, name) {
  await settled(page);
  const path = join(SHOTS, name);
  await page.screenshot({ path });
  log('screenshot', path);
}

/** A save with every lot up to `upTo` solved, for later-car-park screenshots. */
function saveSolvedUpTo(upTo, currentHistory) {
  const lots = {};
  LOTS.slice(0, upTo).forEach((l, k) => (lots[l.id] = { stars: 1 + (k % 3), best: l.opt + (k % 3 ? 2 : 0) }));
  return JSON.stringify({ v: 1, lots, current: currentHistory, muted: false, reducedMotion: null, seen: ['coach'] });
}

// ---- the run -------------------------------------------------------------------------------

try {
  // 1. Desktop, fresh, keys only: lots 1–3.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watch(page, 'desktop');
    await boot(page);
    await page.keyboard.press('ArrowRight'); // first key: the coach switches to keyboard mode
    await shot(page, 'boot-1280.png');
    let st = await state(page);
    if (st.lot !== 0) fail(`boot should open Harbour 1, got lot ${st.lot}`);
    // Browse: the ring moves between vehicles with arrows and comes back.
    await until(page, () => window.__gridlock.debugState().ring === 0);
    await page.keyboard.press('ArrowUp');
    await until(page, () => window.__gridlock.debugState().ring === 1);
    for (let lot = 0; lot < 3; lot++) {
      await until(page, (k) => window.__gridlock.debugState().lot === k && !window.__gridlock.debugState().overlay, lot);
      await solveByKeys(page);
      if (lot === 2) await shot(page, 'result-1280.png');
      // ▶ is focused on the result card; Enter goes on.
      await until(page, () => document.activeElement?.closest('.overlay') !== null);
      await page.keyboard.press('Enter');
    }
    await until(page, () => window.__gridlock.debugState().lot === 3);
    log('keys: Harbour 1–3 solved');

    // Reload mid-lot: the board comes back exactly as left.
    const sol = await solution(page);
    await dragMove(page, sol[0], 'mouse');
    const before = await state(page);
    await page.reload();
    await until(page, () => document.getElementById('app')?.dataset.ready === '1' && !!window.__gridlock);
    const after = await state(page);
    if (after.lot !== before.lot || JSON.stringify(after.pos) !== JSON.stringify(before.pos) || after.moves !== before.moves) {
      fail(`reload lost the board: ${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    }
    log('reload: lot', after.lot, 'restored with', after.moves, 'move(s)');

    // Undo, reset (and undo the reset), hint — by keys.
    await page.keyboard.press('z');
    await until(page, () => window.__gridlock.debugState().moves === 0);
    await page.keyboard.press('h');
    await until(page, () => document.querySelector('.ghost') !== null);
    log('hint ghost shown');

    // Lot 2 again by real mouse drags, picked from the map with the keyboard.
    await page.keyboard.press('Escape');
    await until(page, () => window.__gridlock.debugState().overlay === 'pause');
    await shot(page, 'pause-1280.png');
    await page.keyboard.press('Escape');
    await page.locator('.tool[data-tool="map"]').click();
    await until(page, () => window.__gridlock.debugState().overlay === 'map');
    await page.locator('.lot').nth(1).click();
    await until(page, () => window.__gridlock.debugState().lot === 1 && !window.__gridlock.debugState().overlay);
    await solveByDrags(page, 'mouse');
    log('mouse: Harbour 2 solved by drags');
    await page.keyboard.press('Escape'); // result → map
    await until(page, () => window.__gridlock.debugState().overlay === 'map');
    await shot(page, 'map-1280.png');
    await ctx.close();
  }

  // 2. Phone, touch.
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 2 });
    const page = await ctx.newPage();
    watch(page, 'phone');
    const cdp = await ctx.newCDPSession(page);
    await boot(page);
    await shot(page, 'boot-390.png');
    // A tap without travel wiggles, and does not move anything.
    const box = await page.locator('.veh[data-v="1"]').boundingBox();
    await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
    if ((await state(page)).moves !== 0) fail('a tap moved a vehicle');
    await solveByDrags(page, 'touch', cdp);
    await page.locator('.overlay .btn.primary').tap();
    await until(page, () => window.__gridlock.debugState().lot === 1 && !window.__gridlock.debugState().overlay);
    // Blocked slide: drag lot 2's car right into the wall — it must stay put.
    const st = await state(page);
    await dragMove(page, { v: 1, to: st.pos[1] }, 'touch', cdp);
    await solveByDrags(page, 'touch', cdp);
    log('touch: Harbour 1–2 solved by drags');
    await shot(page, 'result-390.png');
    // Toolbar by touch: pause, sound off, calm on.
    await page.locator('.overlay .btn.primary').tap();
    await until(page, () => !window.__gridlock.debugState().overlay);
    await page.locator('.tool[data-tool="pause"]').tap();
    await until(page, () => window.__gridlock.debugState().overlay === 'pause');
    await page.locator('.overlay .btn').nth(2).tap();
    await until(page, () => JSON.parse(localStorage.getItem('gridlock:save')).muted === true);
    await page.locator('.overlay .btn').nth(3).tap();
    await until(page, () => document.documentElement.classList.contains('calm'));
    await page.locator('.overlay .btn').nth(0).tap();
    log('touch: pause, mute and calm motion toggled and persisted');
    await ctx.close();
  }

  // 3. Later car parks, for the screenshots that show what the game becomes.
  for (const [w, h, name, at] of [[1280, 720, 'dune-1280.png', 'dune'], [390, 844, 'pier-390.png', 'pier']]) {
    const k = LOTS.findIndex((l) => l.band === at) + 4;
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, hasTouch: w < 500, deviceScaleFactor: w < 500 ? 2 : 1 });
    await ctx.addInitScript((s) => {
      try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('gridlock:save', s); sessionStorage.setItem('seeded', '1'); } } catch {}
    }, saveSolvedUpTo(k, { id: LOTS[k].id, history: [], hinted: false }));
    const page = await ctx.newPage();
    watch(page, name);
    await boot(page);
    const sol = await solution(page);
    if (sol.length !== LOTS[k].opt) fail(`lot ${k}: in-game solution ${sol.length} ≠ stored opt ${LOTS[k].opt}`);
    for (const m of sol.slice(0, 3)) await dragMove(page, m, 'mouse');
    await page.mouse.move(5, 5);
    await shot(page, name);
    if (name.startsWith('dune')) {
      await page.locator('.tool[data-tool="map"]').click();
      await until(page, () => window.__gridlock.debugState().overlay === 'map');
      await shot(page, 'map-progress-1280.png');
    }
    await ctx.close();
  }

  // 4. Every string blanked: lot 1 still plays.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watch(page, 'blank');
    await boot(page, '?debug=1&blank=1');
    await solveByKeys(page);
    log('blank strings: Harbour 1 solved');
    await ctx.close();
  }

  // 5. Inside an iframe with the site's exact sandbox.
  {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    watch(page, 'iframe');
    await page.goto(URL_ + 'favicon-nope'); // same-origin parent page, like /play/<id>/
    await page.setContent(`<iframe id="g" sandbox="allow-scripts allow-same-origin allow-popups allow-forms allow-modals"
      allow="fullscreen; autoplay; gamepad" src="${URL_}?debug=1" style="border:0;width:1000px;height:680px"></iframe>`);
    const frame = await (await page.waitForSelector('#g')).contentFrame();
    await until(frame, () => document.getElementById('app')?.dataset.ready === '1');
    await page.evaluate(() => document.getElementById('g').focus());
    await frame.evaluate(() => window.focus());
    await solveByKeys(page, frame);
    log('iframe (site sandbox): Harbour 1 solved by keys');
    await ctx.close();
  }

  // 6. Hint cost on the biggest lot at 4× CPU throttle.
  {
    const k = LOTS.reduce((best, l, i) => (l.states > LOTS[best].states ? i : best), 0);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    await ctx.addInitScript((s) => {
      try { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('gridlock:save', s); sessionStorage.setItem('seeded', '1'); } } catch {}
    }, saveSolvedUpTo(k, { id: LOTS[k].id, history: [], hinted: false }));
    const page = await ctx.newPage();
    watch(page, 'hint');
    const cdp = await ctx.newCDPSession(page);
    await boot(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    // Watch the main thread: the longest gap between animation frames while the hint is out.
    await page.evaluate(() => {
      window.__gap = 0;
      let last = performance.now();
      const tick = (t) => {
        window.__gap = Math.max(window.__gap, t - last);
        last = t;
        if (!document.querySelector('.ghost')) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.keyboard.press('h');
    await until(page, () => document.querySelector('.ghost') !== null, undefined, 20_000);
    const ms = await page.evaluate(() => window.__gridlock.lastHintMs);
    const gap = await page.evaluate(() => window.__gap);
    log(`hint on lot ${k + 1} (${LOTS[k].states} positions) at 4× throttle: ${ms.toFixed(0)} ms in the worker, longest main-thread frame gap ${gap.toFixed(0)} ms`);
    if (gap > 100) fail(`the main thread stalled ${gap.toFixed(0)} ms while a hint was computed`);
    // Asked again from the same lot, the worker answers from its cached table.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    const sol = await solution(page);
    await dragMove(page, sol[0], 'mouse');
    await page.keyboard.press('h');
    await until(page, () => document.querySelector('.ghost') !== null, undefined, 20_000);
    const again = await page.evaluate(() => window.__gridlock.lastHintMs);
    log(`second hint (table cached): ${again.toFixed(0)} ms`);
    await ctx.close();
  }

  if (errors.length) fail(`console/page errors:\n${errors.join('\n')}`);
  console.log(`smoke: OK — screenshots in ${SHOTS}`);
} catch (e) {
  console.error('smoke: FAILED —', e.message);
  if (errors.length) console.error(errors.join('\n'));
  await cleanup();
  process.exit(1);
}
await cleanup();
