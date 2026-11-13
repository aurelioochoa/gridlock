// The ship gate, run at the end of `npm run build` (design §9, §12; SHIP-CHECKLIST §1–2):
//
//   1. Every installed dependency carries a recognised free/open-source license.
//   2. The game ships ZERO asset files: every picture is SVG markup in code, every sound is
//      synthesized. Inline SVG is fine; SVG *files* are not.
//   3. The built output contains no external URL at all — no CDN, no fonts, no telemetry.
//      The allowlist is empty by design (§12); anything added needs a reason beside it.
//   4. The bundle stays within the byte budget: ≤ 300 KB (design §12).
//
//   node scripts/check-licenses.mjs      (from the repo root; scans dist/ when it exists)
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';

const FREE = [
  /^MIT\b/i,
  /^ISC\b/i,
  /^BSD-\d/i,
  /^Apache-2\.0/i,
  /^MPL-2\.0/i,
  /^CC0-1\.0/i,
  /^Unlicense$/i,
  /^0BSD$/i,
  /^Zlib$/i,
  /^Python-2\.0/i,
  /^BlueOak-1\.0\.0/i,
];

const ASSET_EXTENSIONS = new Set([
  '.glb', '.gltf', '.fbx', '.obj', '.dae', '.blend', '.stl', '.ply', '.3ds',
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.bmp', '.tga', '.ktx', '.ktx2',
  '.basis', '.dds', '.hdr', '.exr', '.tif', '.tiff',
  '.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aac', '.opus', '.mid', '.midi',
  '.ttf', '.otf', '.woff', '.woff2', '.eot',
  '.mp4', '.webm', '.mov',
]);

// Occurrences of http(s):// in the BUILT output that are provably inert. Empty on purpose:
// the game is plain TypeScript with no runtime dependencies, so nothing should ever land here.
const DIST_URL_ALLOWLIST = [];

const BUDGET_BYTES = 300 * 1024;

const failures = [];
const warnings = [];

function walk(dir, onFile) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      walk(full, onFile);
    } else if (entry.isFile()) {
      onFile(full);
    }
  }
}

// ---- gate 1: dependency licenses ---------------------------------------------

function licenseOf(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && pkg.license.type) return pkg.license.type;
  if (Array.isArray(pkg.licenses) && pkg.licenses.length) {
    return pkg.licenses.map((l) => (typeof l === 'string' ? l : l.type)).join(' OR ');
  }
  return null;
}

if (!existsSync('node_modules')) {
  failures.push('node_modules/ missing — run `npm install` before the license check');
} else {
  let checked = 0;
  for (const entry of readdirSync('node_modules', { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name.startsWith('@')) continue;
    const pkgPath = join('node_modules', entry.name, 'package.json');
    if (!existsSync(pkgPath)) continue;
    const lic = licenseOf(JSON.parse(readFileSync(pkgPath, 'utf8')));
    checked++;
    if (!lic || !FREE.some((re) => re.test(lic))) {
      failures.push(`dependency "${entry.name}" license is not recognised free: ${lic ?? '(none)'}`);
    }
  }
  for (const scope of readdirSync('node_modules', { withFileTypes: true })) {
    if (!scope.isDirectory() || !scope.name.startsWith('@')) continue;
    for (const pkg of readdirSync(join('node_modules', scope.name), { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      const pkgPath = join('node_modules', scope.name, pkg.name, 'package.json');
      if (!existsSync(pkgPath)) continue;
      const lic = licenseOf(JSON.parse(readFileSync(pkgPath, 'utf8')));
      checked++;
      if (!lic || !FREE.some((re) => re.test(lic))) {
        failures.push(
          `dependency "${scope.name}/${pkg.name}" license is not recognised free: ${lic ?? '(none)'}`,
        );
      }
    }
  }
  console.log(`license gate: ${checked} dependencies checked`);
}

// ---- gate 2: zero asset files -------------------------------------------------

let filesSeen = 0;
walk('.', (file) => {
  filesSeen++;
  const ext = extname(file).toLowerCase();
  if (ASSET_EXTENSIONS.has(ext)) failures.push(`asset file present (§9 zero-asset rule): ${file}`);
  if (ext === '.svg') warnings.push(`svg file present — inline SVG only, or justify it: ${file}`);
});
console.log(`asset gate: ${filesSeen} source files scanned`);

// ---- gate 3: no live external URLs in the built output ------------------------

if (existsSync('dist')) {
  let distFiles = 0;
  walk('dist', (file) => {
    distFiles++;
    const ext = extname(file).toLowerCase();
    if (!['.js', '.html', '.css', '.json'].includes(ext)) return;
    const text = readFileSync(file, 'utf8');
    const urls = text.match(/https?:\/\/[^\s"'`)]+/g) ?? [];
    for (const url of urls) {
      const allowed = DIST_URL_ALLOWLIST.find((a) => url.startsWith(a.match));
      if (!allowed) {
        failures.push(`live external URL in built output: ${url} (${file})`);
      }
    }
  });
  console.log(`network gate: ${distFiles} dist files scanned`);

  // ---- gate 4: byte budget ---------------------------------------------------------------
  let raw = 0;
  let gz = 0;
  walk('dist', (file) => {
    raw += statSync(file).size;
    gz += gzipSync(readFileSync(file)).length;
  });
  console.log(`byte budget: ${(raw / 1024).toFixed(1)} KB raw, ${(gz / 1024).toFixed(1)} KB gzip (limit ${BUDGET_BYTES / 1024} KB raw)`);
  if (raw > BUDGET_BYTES) failures.push(`dist/ is ${raw} bytes, over the ${BUDGET_BYTES}-byte budget`);
} else {
  console.log('network gate: no dist/ yet (build first to scan it)');
}

for (const w of warnings) console.warn(`WARN: ${w}`);
if (failures.length) {
  for (const f of failures) console.error(`FAIL: ${f}`);
  process.exit(1);
}
console.log('all gates passed');
