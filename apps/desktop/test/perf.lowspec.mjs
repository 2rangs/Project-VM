// Low-spec probe: launches the built app with SOFTWARE rendering (no GPU) and a CPU throttle, so a
// cloud Linux box stands in for an office laptop (integrated graphics, 4 cores). Reports startup
// time, per-process memory (main + renderer), match-screen FPS/CPU for the 2D tactical map and the
// 3D team cams, and the career menu transition time. Prints one JSON blob (the before/after rows
// in docs/handoff/lowspec.md come from this).
//
//   npm run build && xvfb-run -a node test/perf.lowspec.mjs
//   THROTTLE=4 SAMPLE_MS=6000 LABEL=before node test/perf.lowspec.mjs
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');

const THROTTLE = Number(process.env.THROTTLE ?? 4);   // CDP CPU slowdown multiplier (low-spec proxy)
const SAMPLE_MS = Number(process.env.SAMPLE_MS ?? 6000);
const LABEL = process.env.LABEL ?? 'run';
const round1 = (v) => Math.round(v * 10) / 10;

// ── per-process memory, read from /proc (Linux) ──────────────────────────────────────────────
function procTree(root) {
  const pids = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
  const ppid = new Map(); const cmd = new Map();
  for (const pid of pids) {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      ppid.set(pid, Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]));
      cmd.set(pid, fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' '));
    } catch { /* gone */ }
  }
  const kids = new Map();
  for (const [pid, pp] of ppid) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(pid); }
  const out = []; const stack = [root];
  while (stack.length) { const p = stack.pop(); out.push(p); for (const k of kids.get(p) ?? []) stack.push(k); }
  return out.map((pid) => ({ pid, cmd: cmd.get(pid) ?? '' }));
}
function rssMb(pid) {
  try { const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? Number(m[1]) / 1024 : 0; } catch { return 0; }
}
function cpuJiffies(pid) {
  try { const f = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); const p = f.slice(f.lastIndexOf(')') + 2).split(' '); return Number(p[11]) + Number(p[12]); } catch { return 0; }
}
function memSnapshot(root) {
  const tree = procTree(root);
  const classify = (c) => (!/--type=/.test(c) ? 'main' : /--type=renderer/.test(c) ? 'renderer' : /--type=gpu/.test(c) ? 'gpu' : 'other');
  const by = { main: 0, renderer: 0, gpu: 0, other: 0 };
  for (const { pid, cmd } of tree) by[classify(cmd)] += rssMb(pid);
  return { mainMb: round1(by.main), rendererMb: round1(by.renderer), gpuMb: round1(by.gpu), otherMb: round1(by.other), totalMb: round1(by.main + by.renderer + by.gpu + by.other) };
}
// Aggregate CPU% of the whole Electron process tree across a window (clock ticks → % of one core).
const HZ = 100;
function cpuPercent(root, ms, before) {
  let now = 0; for (const { pid } of procTree(root)) now += cpuJiffies(pid);
  if (before == null) return { now };
  return { now, pct: round1(((now - before) / HZ) / (ms / 1000) * 100) };
}

async function sampleFps(page, ms) {
  return page.evaluate(async (dur) => {
    const gaps = []; const longs = [];
    const po = new PerformanceObserver((l) => { for (const e of l.getEntries()) longs.push(e.duration); });
    try { po.observe({ type: 'longtask', buffered: false }); } catch { /* */ }
    let last = performance.now(); const end = last + dur;
    await new Promise((res) => { const f = (t) => { gaps.push(t - last); last = t; if (t < end) requestAnimationFrame(f); else res(); }; requestAnimationFrame(f); });
    po.disconnect();
    gaps.shift(); gaps.sort((a, b) => a - b);
    const q = (p) => gaps[Math.min(gaps.length - 1, Math.floor(p * gaps.length))] ?? 0;
    const perf = window.__mdxPerf ? { ...window.__mdxPerf } : null;
    return { fps: gaps.length / (dur / 1000), p50: q(0.5), p95: q(0.95), frames: gaps.length, over17: gaps.filter((g) => g > 17.5).length, longN: longs.length, perf };
  }, ms);
}
// FPS + aggregate CPU% measured over the same window.
async function sampleScreen(page, root, label) {
  const c0 = cpuPercent(root, 0, null).now; const t0 = Date.now();
  const r = await sampleFps(page, SAMPLE_MS);
  const cpu = cpuPercent(root, Date.now() - t0, c0);
  const out = { fps: round1(r.fps), p50ms: round1(r.p50), p95ms: round1(r.p95), framesOver17: r.over17, cpuPct: cpu.pct, render3dAvgMs: r.perf ? round1(r.perf.avgMs) : null, map: r.perf?.map ?? null };
  console.log(`[${LABEL}] ${label}`, JSON.stringify(out));
  return out;
}

async function main() {
  const tLaunch = Date.now();
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(appDir, 'out/main/index.js'), '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
    cwd: appDir,
    env: { ...process.env, PV_REPO_ROOT: path.resolve(appDir, '..', '..'), PV_MATCH_SCRIPT: path.join(appDir, 'scripts', 'run-match.mts'), PV_SESSION_SCRIPT: path.join(appDir, 'scripts', 'match-session.mts'), PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'), PV_MAP_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'), PV_BANNER_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'), PV_MEDIA_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets') },
  });
  const root = app.process().pid;
  app.process().on('exit', (code, sig) => { if (code) console.log('[electron exit]', code, sig); });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.setViewportSize?.({ width: 1366, height: 768 }).catch(() => {}); // low-spec screen

  // 1. startup: launch → start menu interactive
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
  const startupMs = Date.now() - tLaunch;

  // Optionally pin the graphics quality (else the app auto-detects from hardware).
  const QUALITY = process.env.QUALITY || '';
  if (QUALITY) {
    await page.evaluate((q) => { try { localStorage.setItem('pv-graphics-quality', q); } catch { /* */ } }, QUALITY);
    await page.reload();
    await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
  }
  const quality = await page.evaluate(() => { try { return localStorage.getItem('pv-graphics-quality'); } catch { return null; } });

  // CPU throttle (low-spec proxy) from here on
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }).catch(() => {});

  await page.waitForTimeout(800);
  const memStart = memSnapshot(root);

  // 2. career menu transition: start menu → new career screen
  const tNav = Date.now();
  await page.getByTestId('start-new-career').click();
  await page.waitForSelector('[data-testid="new-career"]', { timeout: 20000 }).catch(() => {});
  const careerNavMs = Date.now() - tNav;
  await page.waitForTimeout(400);
  const memCareer = memSnapshot(root);

  // 3. match screen via Quick Match sandbox
  await page.evaluate(() => { try { localStorage.removeItem('pv-matchday-view'); } catch { /* */ } });
  // back to start menu, then into the sandbox (lift the throttle while the bundle re-parses)
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
  await page.reload().catch(() => {});
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE }).catch(() => {});
  await page.getByTestId('start-quick-match').click();
  await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });
  await page.getByTestId('run-match').click();
  await page.waitForSelector('[data-testid="scoreboard"]', { timeout: 150000 });
  await page.waitForTimeout(1500);
  await page.getByTestId('round-chip-3').click().catch(() => {});
  await page.waitForTimeout(500);
  const ensurePlaying = async () => { const lbl = await page.getByTestId('playpause').getAttribute('aria-label').catch(() => ''); if (!/일시|ause/i.test(lbl ?? '')) await page.getByTestId('playpause').click().catch(() => {}); };
  await ensurePlaying(); await page.waitForTimeout(1000);
  const memMatch2d = memSnapshot(root);
  const tac = await sampleScreen(page, root, 'tactical-2d');

  // switch to 3D team cams (only when this quality offers them)
  let memMatch3d = null; let cams = null;
  const hasCams = await page.locator('[data-testid="view-mode-cams"]').count().catch(() => 0);
  if (hasCams) {
    await page.keyboard.press('KeyM');
    await page.waitForFunction(() => window.__mdxPerf?.map === 'glb', null, { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2500); await ensurePlaying();
    memMatch3d = memSnapshot(root);
    cams = await sampleScreen(page, root, 'cams-3d');
  } else {
    console.log(`[${LABEL}] cams-3d skipped (3D off at quality=${quality})`);
  }

  const result = {
    label: LABEL, quality, throttle: THROTTLE, sampleMs: SAMPLE_MS, screen: '1366x768',
    startupMs, careerNavMs,
    memory: { startMenu: memStart, newCareer: memCareer, match2d: memMatch2d, match3d: memMatch3d },
    tactical2d: tac, cams3d: cams,
  };
  console.log('RESULT_JSON ' + JSON.stringify(result));
  const outDir = path.join(appDir, 'test', '.perf');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `lowspec-${LABEL}.json`), JSON.stringify(result, null, 2));
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
