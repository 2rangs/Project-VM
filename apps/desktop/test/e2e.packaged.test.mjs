// Packaged-app smoke test: copy the built .app out of the repository, launch it with a clean
// environment, play one quick match and screenshot it. Proves the packaged build runs with no
// repository, no node_modules and no tsx — the engine comes from the bundle in app.asar and its
// data from Resources/engine.
//   npm run package:mac && node test/e2e.packaged.test.mjs     (opens a real window)
// Needs Playwright via PLAYWRIGHT_REQUIRE_BASE, like the other e2e tests. Writes
// docs/desktop-packaged.png.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const repoRoot = path.resolve(appDir, '..', '..');
const OUT = path.join(appDir, 'docs');

function builtApp() {
  const dist = path.join(appDir, 'dist');
  for (const d of fs.existsSync(dist) ? fs.readdirSync(dist) : []) {
    if (!d.startsWith('mac')) continue;
    const app = fs.readdirSync(path.join(dist, d)).find((f) => f.endsWith('.app'));
    if (app) return path.join(dist, d, app);
  }
  throw new Error('no packaged .app under dist/ — run `npm run package:mac` first');
}

async function main() {
  // Out of the repository: nothing above the app can be found by walking up from it.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-packaged-'));
  const appPath = path.join(tmp, path.basename(builtApp()));
  execFileSync('cp', ['-R', builtApp(), appPath]); // keeps symlinks and the signature
  assert.ok(!appPath.startsWith(repoRoot), 'the copy is outside the repository');
  const exe = path.join(appPath, 'Contents', 'MacOS', path.basename(appPath, '.app'));

  // A clean environment: no PV_* override may point back into the repository, and node tooling
  // (nvm / npx / tsx) is not on PATH.
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('PV_') && !k.startsWith('npm_') && !k.startsWith('NVM_') && k !== 'NODE_PATH' && k !== 'NODE_OPTIONS'));
  env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin';

  let app; let failed = null;
  try {
    app = await electron.launch({ executablePath: exe, args: [`--user-data-dir=${path.join(tmp, 'user-data')}`], cwd: tmp, env });
    const info = await app.evaluate(({ app: a }) => ({ packaged: a.isPackaged, appPath: a.getAppPath(), resources: process.resourcesPath, userData: a.getPath('userData') }));
    console.log('packaged app:', JSON.stringify(info));
    assert.equal(info.packaged, true, 'app.isPackaged');
    assert.ok(info.appPath.endsWith('app.asar'), 'runs from app.asar');
    assert.ok(info.appPath.startsWith(tmp) && info.userData.startsWith(tmp), 'app and user data are in the temp copy');
    assert.ok(fs.existsSync(path.join(info.resources, 'engine', 'packages', 'match-runner', 'data')), 'engine data is in Resources/engine');

    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.waitForSelector('[data-testid="start-menu"]', { timeout: 30000 });
    await page.getByTestId('start-quick-match').click();
    await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });

    // Record every text the load screen's step line shows: round progress must arrive WHILE the
    // engine worker is busy (a burst at the end would render only the last value).
    await page.evaluate(() => {
      window.__steps = new Set();
      new MutationObserver(() => {
        const el = document.querySelector('[data-testid="loading-steps"]');
        if (el?.textContent?.trim()) window.__steps.add(el.textContent.trim());
      }).observe(document.body, { subtree: true, childList: true, characterData: true });
    });
    const t0 = Date.now();
    await page.getByTestId('run-match').click();
    await page.waitForSelector('.rv-src-simulated', { timeout: 120000 });
    const steps = await page.evaluate(() => [...window.__steps]);
    console.log(`load screen showed ${steps.length} distinct progress lines, e.g. ${JSON.stringify(steps.slice(0, 4))}`);
    assert.ok(steps.length >= 5, `round progress streamed live from the engine worker (saw ${steps.length} lines)`);
    await page.waitForSelector('[data-testid="scoreboard"]', { timeout: 10000 });
    const sb = (await page.getByTestId('scoreboard').innerText()).replace(/\s+/g, ' ');
    console.log(`quick match finished in ${((Date.now() - t0) / 1000).toFixed(1)} s — scoreboard: ${sb}`);
    assert.ok(/\b13\b|\b1[4-9]\b|\b2\d\b/.test(sb), 'a full first-to-13 map was played');
    // The round-simulator fallback has no decisions: their presence proves the real engine ran.
    await page.getByTestId('tab-review').click();
    await page.waitForSelector('[data-testid="rev-decisions-panel"]', { timeout: 10000 });
    assert.ok(await page.locator('[data-testid^="dec-pick-"]').count() >= 13, 'the bundled match engine produced the match (round decisions present)');
    assert.equal(await page.getByTestId('dec-none').count(), 0);
    await page.getByTestId('tab-match').click();
    await page.waitForTimeout(1500);
    fs.mkdirSync(OUT, { recursive: true });
    await page.screenshot({ path: path.join(OUT, 'desktop-packaged.png') });

    // no node / tsx child was spawned: the only children are Electron's own helpers
    const pid = app.process().pid;
    const kids = execFileSync('pgrep', ['-lf', '-P', String(pid)], { encoding: 'utf8' }).split('\n').filter(Boolean);
    assert.ok(kids.length > 0 && kids.every((k) => k.includes(appPath)), `unexpected child process: ${kids.find((k) => !k.includes(appPath))}`);
    assert.ok(kids.some((k) => /pv-engine-match|utility/i.test(k)), 'an engine utility process is running');
    assert.deepEqual(errors, [], 'no page errors');
  } catch (e) { failed = e; } finally {
    await app?.close().catch(() => {});
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  if (failed) throw failed;
  console.log('PACKAGED E2E OK — screenshot in apps/desktop/docs/desktop-packaged.png');
}
main().catch((e) => { console.error('PACKAGED E2E FAILED:', e); process.exit(1); });
