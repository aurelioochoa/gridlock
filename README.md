# Gridlock

The ice-cream van is boxed in at the seaside car park: slide the cars and camper vans out of
its way until it can roll out to the beach. 130 hand-ordered, solver-proved lots in six car
parks; no timer, no way to lose, and every slide can be slid back. A first-party game for
[kidtopiaplay.com](https://kidtopiaplay.com), in eight languages, with zero asset files.

## Run, build, test

```bash
npm install
npm run dev      # dev server
npm run build    # type-check + production build + license/asset/network/byte-budget gate
npm test         # Vitest: rules, solver, history, saves, string parity, and all 130 lots re-proved
npm run smoke    # drives dist/ in headless Chromium: keys, mouse, touch, iframe sandbox, screenshots
npm run lots     # dev-only: regenerate src/data/lots.json (never run by the build)
```

`src/sim/` is pure (board, slides, solver, history); the lots in `src/data/lots.json` are frozen
and re-verified by `src/sim/lots.test.ts` with an independent reference solver. The design is
`docs/game-design/designs/gridlock.md` in the kidtopiaplay.com repo.

## License

- Noncommercial use (personal, study, hobby, evaluation, noncommercial
  modifications and redistribution): free under
  [PolyForm Noncommercial 1.0.0](./LICENSE.md).
- **Any commercial use — anything that makes money, including ads,
  subscriptions, resale, SaaS hosting or revenue-supporting business use —
  requires a paid license.** See [COMMERCIAL-LICENSE.md](./COMMERCIAL-LICENSE.md).
- Third-party components keep their own licenses, see
  [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md).

This is source-available, not OSI open source: you may download, read and
reuse it for free as long as you do not make money with it. Only the
licensor (© 2026 Aurelio Ochoa) may grant commercial rights.
