// Playback frame-rate probe: launches the built app on the real GPU, starts a match, and measures
// requestAnimationFrame intervals and long tasks while a round plays, in tactical and cams modes.
//   npm run build && node test/perf.playback.mjs
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
// Playwright is not a dependency of this app: PLAYWRIGHT_REQUIRE_BASE names a directory whose node_modules has it.
const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');

const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 6000);
async function sample(page, label) {
  const r = await page.evaluate(async (ms) => {
    const gaps = []; const longs = [];
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); });
    try { po.observe({ type: 'longtask', buffered: false }); } catch { /* */ }
    let last = performance.now(); const end = last + ms;
    await new Promise((res) => { const f = (t) => { gaps.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    po.disconnect();
    gaps.shift(); gaps.sort((a, b) => a - b);
    const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))];
    const perf = window.__mdxPerf ? { ...window.__mdxPerf } : null;
    return { fps: gaps.length / (ms / 1000), p50: q(0.5), p95: q(0.95), p99: q(0.99), max: gaps[gaps.length - 1], over17: gaps.filter((g) => g > 17.5).length, frames: gaps.length, longN: longs.length, longMax: longs.length ? Math.max(...longs) : 0, longSum: longs.reduce((s, x) => s + x, 0), perf };
  }, SAMPLE_MS);
  console.log(label, JSON.stringify(r, (k, v) => (typeof v === 'number' ? Math.round(v * 10) / 10 : v)));
  return r;
}

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(appDir, 'out/main/index.js')],
  cwd: appDir,
  env: { ...process.env, PV_REPO_ROOT: path.resolve(appDir, '..', '..'), PV_MATCH_SCRIPT: path.join(appDir, 'scripts', 'run-match.mts'), PV_SESSION_SCRIPT: path.join(appDir, 'scripts', 'match-session.mts'), PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces') },
});
app.process().stderr?.on('data', (d) => { const t = String(d); if (/error|fatal|crash|gpu|oom|killed|exit/i.test(t)) console.log('[electron]', t.trim().slice(0, 400)); });
app.process().on('exit', (code, sig) => console.log('[electron exit]', code, sig));
app.on('window', () => {});
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
page.on('crash', () => console.log('[crash] renderer crashed'));
page.on('close', () => console.log('[close] page closed'));
page.on('console', (m) => { if (/error|warn|cams/i.test(m.type() + m.text())) console.log('[console]', m.type(), m.text().slice(0, 200)); });
await page.setViewportSize?.({ width: 1600, height: 900 }).catch(() => {});
await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 30000 });
await page.evaluate(() => localStorage.removeItem('pv-matchday-view'));
await page.getByTestId('run-match').click();
await page.waitForSelector('[data-testid="scoreboard"]', { timeout: 120000 });
await page.waitForTimeout(1500);
await page.getByTestId('round-chip-3').click().catch(() => {});
await page.waitForTimeout(500);
const ensurePlaying = async () => { const lbl = await page.getByTestId('playpause').getAttribute('aria-label'); if (!/일시|ause/i.test(lbl ?? '')) await page.getByTestId('playpause').click(); };
await ensurePlaying(); await page.waitForTimeout(1000);
await sample(page, 'tactical');
await page.keyboard.press('KeyM'); await page.waitForFunction(() => window.__mdxPerf?.map === 'glb', null, { timeout: 30000 }).catch(() => {}); await page.waitForTimeout(2500); await ensurePlaying();
let cdp = null;
if (process.env.PROFILE) { cdp = await page.context().newCDPSession(page); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start'); }
await sample(page, 'cams');
if (cdp) {
  const { profile } = await cdp.send('Profiler.stop');
  const self = new Map(); const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const dt = profile.timeDeltas; const counts = new Map();
  profile.samples.forEach((id, i) => counts.set(id, (counts.get(id) ?? 0) + (dt[i] ?? 0)));
  for (const [id, us] of counts) { const n = byId.get(id); const f = n.callFrame; const k = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`; self.set(k, (self.get(k) ?? 0) + us); }
  console.log('top self time (ms):'); [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).forEach(([k, us]) => console.log(`  ${(us / 1000).toFixed(1)}  ${k}`));
}
if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT });
await app.close();
