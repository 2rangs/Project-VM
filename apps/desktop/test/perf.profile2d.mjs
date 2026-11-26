// CPU profile of the TACTICAL 2D frame (the low-spec default view). Launches the built app on
// software GL, runs a match, keeps the tactical map, plays, and samples the V8 CPU profiler, then
// prints top self-time functions. Use it to find the per-frame hot spots before/after a change.
//   npm run build && xvfb-run -a node test/perf.profile2d.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 6000);
const THROTTLE = Number(process.env.THROTTLE ?? 4);

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(appDir, 'out/main/index.js'), '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
  cwd: appDir,
  env: { ...process.env, PV_REPO_ROOT: path.resolve(appDir, '..', '..'), PV_MATCH_SCRIPT: path.join(appDir, 'scripts', 'run-match.mts'), PV_SESSION_SCRIPT: path.join(appDir, 'scripts', 'match-session.mts'), PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'), PV_MAP_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'), PV_BANNER_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'), PV_MEDIA_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets') },
});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.setViewportSize?.({ width: 1366, height: 768 }).catch(() => {});
await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
await page.evaluate((q) => { try { localStorage.setItem('pv-graphics-quality', q); localStorage.removeItem('pv-matchday-view'); } catch { /* */ } }, process.env.QUALITY || 'low');
await page.reload();
await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
await page.getByTestId('start-quick-match').click();
await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });
await page.getByTestId('run-match').click();
await page.waitForSelector('[data-testid="scoreboard"]', { timeout: 150000 });
await page.waitForTimeout(1200);
await page.getByTestId('round-chip-3').click().catch(() => {});
await page.waitForTimeout(400);
const ensurePlaying = async () => { const lbl = await page.getByTestId('playpause').getAttribute('aria-label').catch(() => ''); if (!/일시|ause/i.test(lbl ?? '')) await page.getByTestId('playpause').click().catch(() => {}); };
await ensurePlaying(); await page.waitForTimeout(800);

const cdp = await page.context().newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }).catch(() => {});
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 150 }); await cdp.send('Profiler.start');
await page.waitForTimeout(SAMPLE_MS);
const { profile } = await cdp.send('Profiler.stop');
const byId = new Map(profile.nodes.map((n) => [n.id, n])); const dt = profile.timeDeltas; const counts = new Map();
profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
const self = new Map();
for (const [id, us] of counts) { const n = byId.get(id); if (!n) continue; const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + us); }
const total = [...counts.values()].reduce((s, x) => s + x, 0) / 1000;
console.log(`total sampled: ${total.toFixed(0)} ms (quality=${process.env.QUALITY || 'low'}, throttle=${THROTTLE})`);
console.log('top self time (ms):');
[...self].sort((a, b) => b[1] - a[1]).slice(0, 22).forEach(([k, us]) => console.log(`  ${(us / 1000).toFixed(1)}  ${k}`));
await app.close();
