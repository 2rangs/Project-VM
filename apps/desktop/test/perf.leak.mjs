// Match-screen leak probe: opens and closes the live match screen many times (high graphics, so
// both the PixiJS 2D stage and the three.js 3D wall are built and must be disposed each cycle), and
// compares the renderer JS heap and process RSS after a forced GC. A flat trend ⇒ the stages are
// released; a rising one ⇒ a leak.
//   npm run build && CYCLES=10 xvfb-run -a node test/perf.leak.mjs
import path from 'node:path';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');
const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');
const CYCLES = Number(process.env.CYCLES ?? 10);

function rssMb(pid) {
  try { const m = /VmRSS:\s+(\d+) kB/.exec(fs.readFileSync(`/proc/${pid}/status`, 'utf8')); return m ? Math.round(m[1] / 1024) : 0; } catch { return 0; }
}
function tree(root) {
  const pids = fs.readdirSync('/proc').filter((n) => /^\d+$/.test(n)).map(Number);
  const ppid = new Map(); const cmd = new Map();
  for (const pid of pids) { try { const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'); ppid.set(pid, Number(s.slice(s.lastIndexOf(')') + 2).split(' ')[1])); cmd.set(pid, fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').replace(/\0/g, ' ')); } catch { /* */ } }
  const kids = new Map(); for (const [pid, pp] of ppid) { if (!kids.has(pp)) kids.set(pp, []); kids.get(pp).push(pid); }
  const out = []; const stack = [root]; while (stack.length) { const p = stack.pop(); out.push({ pid: p, cmd: cmd.get(p) ?? '' }); for (const k of kids.get(p) ?? []) stack.push(k); }
  return out;
}
function treeRssMb(root) { let t = 0; for (const { pid } of tree(root)) t += rssMb(pid); return t; }
function rssByKind(root) {
  const k = { main: 0, renderer: 0, gpu: 0, other: 0 }; let count = 0;
  for (const { pid, cmd } of tree(root)) { count++; const m = rssMb(pid); k[!/--type=/.test(cmd) ? 'main' : /--type=renderer/.test(cmd) ? 'renderer' : /--type=gpu/.test(cmd) ? 'gpu' : 'other'] += m; }
  return { ...k, procs: count };
}

const app = await electron.launch({
  executablePath: electronPath,
  args: [path.join(appDir, 'out/main/index.js'), '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
  cwd: appDir,
  env: { ...process.env, PV_REPO_ROOT: path.resolve(appDir, '..', '..'), PV_MATCH_SCRIPT: path.join(appDir, 'scripts', 'run-match.mts'), PV_SESSION_SCRIPT: path.join(appDir, 'scripts', 'match-session.mts'), PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'), PV_MAP_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'), PV_BANNER_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'), PV_MEDIA_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets') },
});
const root = app.process().pid;
const page = await app.firstWindow();
page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
await page.setViewportSize?.({ width: 1366, height: 768 }).catch(() => {});
await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
await page.evaluate((q) => { try { localStorage.setItem('pv-graphics-quality', q); localStorage.removeItem('pv-matchday-view'); } catch { /* */ } }, process.env.QUALITY || 'high');
await page.reload();
await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
await page.getByTestId('start-quick-match').click();
await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });

const cdp = await page.context().newCDPSession(page);
await cdp.send('Performance.enable').catch(() => {});
async function heapMb() {
  for (let i = 0; i < 4; i++) await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  await page.waitForTimeout(300);
  const { metrics } = await cdp.send('Performance.getMetrics');
  const h = metrics.find((m) => m.name === 'JSHeapUsedSize');
  return h ? Math.round(h.value / 1048576) : 0;
}

const rows = [];
for (let i = 0; i < CYCLES; i++) {
  await page.getByTestId('run-match').click();
  await page.waitForSelector('[data-testid="scoreboard"]', { timeout: 150000 });
  await page.waitForTimeout(600);
  await page.keyboard.press('KeyM'); // build the 3D wall
  await page.waitForTimeout(1200);
  await page.getByTestId('md-exit').click();                 // unmount the live screen (dispose stages)
  await page.waitForSelector('[data-testid="run-match"]', { timeout: 20000 });
  const heap = await heapMb();
  const kind = rssByKind(root);
  const rss = treeRssMb(root);
  rows.push({ cycle: i + 1, heapMb: heap, rssMb: rss, kind });
  console.log(`[leak] cycle ${i + 1}/${CYCLES}  heap=${heap}MB  rss=${rss}MB  (renderer=${kind.renderer} gpu=${kind.gpu} main=${kind.main} other=${kind.other} procs=${kind.procs})`);
}
const first = rows[1] ?? rows[0]; const last = rows[rows.length - 1]; // skip cycle 1 (cold caches)
const out = { cycles: CYCLES, heapStartMb: first.heapMb, heapEndMb: last.heapMb, heapGrowthMb: last.heapMb - first.heapMb, rssStartMb: first.rssMb, rssEndMb: last.rssMb, rssGrowthMb: last.rssMb - first.rssMb, rows };
console.log('LEAK_JSON ' + JSON.stringify(out));
fs.mkdirSync(path.join(appDir, 'test', '.perf'), { recursive: true });
fs.writeFileSync(path.join(appDir, 'test', '.perf', 'leak.json'), JSON.stringify(out, null, 2));
await app.close();
