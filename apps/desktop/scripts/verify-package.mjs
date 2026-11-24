// Check what a packaged build actually contains (run by `npm run package:mac`, or on its own:
//   node scripts/verify-package.mjs [path/to/PROJECT V.app]).
// Fails if the app carries anything it must not (node_modules, a TypeScript runner, map geometry,
// banners, files outside the engine-data allowlist) or lacks what it needs to run without the repo.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { engineDataFiles } from './stage-engine-data.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const require = createRequire(path.join(appDir, 'package.json'));

function findApp() {
  if (process.argv[2]) return path.resolve(process.argv[2]);
  const dist = path.join(appDir, 'dist');
  for (const d of existsSync(dist) ? readdirSync(dist) : []) {
    if (!d.startsWith('mac')) continue;
    const app = readdirSync(path.join(dist, d)).find((f) => f.endsWith('.app'));
    if (app) return path.join(dist, d, app);
  }
  throw new Error('no packaged .app under dist/ — run `npm run package:mac`');
}
function walk(dir, out = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isSymbolicLink()) continue; // framework "Current" links would be counted twice
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out); else out.push(p);
  }
  return out;
}

const app = findApp();
const resources = path.join(app, 'Contents', 'Resources');
const asarPath = path.join(resources, 'app.asar');
const problems = [];
const need = (ok, msg) => { if (!ok) problems.push(msg); };

need(existsSync(asarPath), 'Resources/app.asar is missing');
const asarList = require('@electron/asar').listPackage(asarPath, { isPack: false }).map((f) => f.replace(/\\/g, '/'));
for (const f of ['/out/main/index.js', '/out/main/engine-host.js', '/out/preload/index.mjs', '/out/renderer/index.html', '/package.json']) {
  need(asarList.includes(f), `app.asar lacks ${f}`);
}
const FORBIDDEN = [
  [/\/node_modules\//, 'node_modules'],
  [/\.(glb|gltf|blend|fbx|obj)$/i, 'map / model geometry'],
  [/\/assets\/(maps|banners)\//, 'git-ignored local assets (maps / banners)'],
  [/\.(mts|tsx?)$/, 'TypeScript source'],
  [/\/scripts\//, 'workspace scripts'],
];
const resourceFiles = walk(resources).map((f) => '/' + path.relative(resources, f).split(path.sep).join('/'))
  .filter((f) => !f.endsWith('.lproj/InfoPlist.strings') && !/^\/(electron\.icns|icon\.icns|app\.asar)$/.test(f));
for (const f of [...asarList, ...resourceFiles]) {
  for (const [re, what] of FORBIDDEN) if (re.test(f)) problems.push(`must not ship (${what}): ${f}`);
}

// engine data: exactly the allowlist, nothing more, nothing less
const engineDir = path.join(resources, 'engine');
need(existsSync(engineDir), 'Resources/engine (engine data) is missing');
if (existsSync(engineDir)) {
  const shipped = walk(engineDir).map((f) => path.relative(engineDir, f).split(path.sep).join('/')).filter((f) => f !== 'engine-data-manifest.json').sort();
  const expected = engineDataFiles();
  for (const f of shipped) if (!expected.includes(f)) problems.push(`engine data outside the allowlist: ${f}`);
  for (const f of expected) if (!shipped.includes(f)) problems.push(`engine data missing from the package: ${f}`);
}
const others = readdirSync(resources).filter((f) => !/\.lproj$|^app\.asar$|^engine$|\.icns$/.test(f));
need(others.length === 0, `unexpected entries in Resources: ${others.join(', ')}`);

const size = (p) => (statSync(p).isDirectory() ? walk(p).reduce((s, f) => s + statSync(f).size, 0) : statSync(p).size);
const cards = asarList.filter((f) => f.startsWith('/assets/playercards/') && /\.\w+$/.test(f)).length;
console.log(`package: ${app}`);
console.log(`  app.asar ${(size(asarPath) / 1e6).toFixed(1)} MB (${asarList.length} entries) · engine data ${(size(engineDir) / 1e6).toFixed(1)} MB · whole app ${(size(app) / 1e6).toFixed(0)} MB`);
console.log(`  player cards shipped: ${cards}${cards ? '  ← third-party art: RELEASE REVIEW REQUIRED (docs/HANDOFF.md §6)' : ''}`);
const info = readFileSync(path.join(app, 'Contents', 'Info.plist'), 'utf8');
console.log(`  bundle id ${/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)/.exec(info)?.[1]} · version ${/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)/.exec(info)?.[1]}`);
if (problems.length) { console.error(`\nPACKAGE CHECK FAILED (${problems.length}):\n  - ${problems.join('\n  - ')}`); process.exit(1); }
console.log('  OK — no node_modules, no TypeScript runner, no map geometry or banners; engine data matches the allowlist');
