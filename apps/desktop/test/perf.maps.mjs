// Frame-time probe for the team cams on every map's GLB (the app plays Ascent only; this harness mirrors
// the cams renderer: five monitors + first-person rigs + ten skinned operators + static sun shadow).
//   node test/perf.maps.mjs [map ...]       (default: every map that has a GLB)
// Run through heavy-run.sh. Env: PLAYWRIGHT_REQUIRE_BASE (playwright), PV_ASSETS (default ~/ProjectV-assets),
// FRAMES (default 360), OUT (JSON results file).
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');
const esbuild = createRequire(path.join(appDir, 'package.json'))('esbuild');
const assets = process.env.PV_ASSETS || path.join(os.homedir(), 'ProjectV-assets');
const glbDir = path.join(assets, 'maps', 'glb');
const ALL = ['abyss', 'ascent', 'bind', 'breeze', 'fracture', 'haven', 'icebox', 'lotus', 'pearl', 'split', 'sunset'];
const maps = (process.argv.slice(2).length ? process.argv.slice(2) : ALL).filter((m) => fs.existsSync(path.join(glbDir, `${m}.glb`)));

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-perf-maps-'));
await esbuild.build({ entryPoints: [path.join(appDir, 'test/perf/maps-harness.ts')], bundle: true, format: 'esm', outfile: path.join(work, 'harness.js'), logLevel: 'error', loader: { '.ts': 'ts' } });
fs.writeFileSync(path.join(work, 'index.html'), '<!doctype html><meta charset="utf-8"><script type="module" src="/harness.js"></script>');
fs.writeFileSync(path.join(work, 'main.cjs'), `const { app, BrowserWindow } = require('electron'); app.disableDomainThrottlingForCrossProcessFrames?.();
app.commandLine.appendSwitch('disable-renderer-backgrounding'); app.commandLine.appendSwitch('disable-background-timer-throttling'); app.commandLine.appendSwitch('disable-frame-rate-limit');
app.whenReady().then(() => { const w = new BrowserWindow({ width: 1600, height: 900, show: true, webPreferences: { backgroundThrottling: false } }); w.loadURL(process.env.PV_HARNESS_URL + '/index.html'); });`);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary' };
const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.startsWith('/glb/') ? path.join(glbDir, path.basename(u.pathname))
    : u.pathname.startsWith('/nav/') ? path.join(appDir, '..', '..', 'datasets', 'spatial', path.basename(u.pathname).split('.')[0], path.basename(u.pathname))
      : path.join(work, path.basename(u.pathname));
  if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(p)] ?? 'application/octet-stream' }); fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}`;

const results = [];
for (const m of maps) {
  const app = await electron.launch({ executablePath: electronPath, args: [path.join(work, 'main.cjs')], env: { ...process.env, PV_HARNESS_URL: url } });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log('[pageerror]', e.message));
  await page.evaluate(() => 0);
  await page.goto(`${url}/index.html?map=${m}&frames=${process.env.FRAMES ?? 360}`);
  try {
    await page.waitForFunction(() => window.__perf || window.__perfError, null, { timeout: 180000, polling: 500 });
    const r = await page.evaluate(() => window.__perf ?? { error: window.__perfError });
    console.log(JSON.stringify(r)); results.push(r);
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `${m}-cams.png`) });
  } catch (e) { console.log(m, 'failed', String(e).slice(0, 200)); results.push({ map: m, error: String(e) }); }
  await app.close();
}
server.close();
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify(results, null, 1));
