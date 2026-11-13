# Third-party notices

Gridlock ships **no third-party code at runtime**: the built bundle is this repository's own
TypeScript, with every picture drawn as SVG markup in code and every sound synthesized with
Web Audio. There are no runtime dependencies.

Development-only tools (never shipped in `dist/`), each under its own license:

| Package | Version | License | Use |
|---|---|---|---|
| typescript | 5.9.3 | Apache-2.0 | type-checking |
| vite | 8.2.2 | MIT | dev server and bundler |
| vitest | 4.1.11 | MIT | unit tests |
| playwright | 1.65.0 | Apache-2.0 | headless smoke test (`scripts/smoke.mjs`) |

Their transitive dependencies are checked on every build by `scripts/check-licenses.mjs`,
which fails on any license that is not a recognised free/open-source one.
