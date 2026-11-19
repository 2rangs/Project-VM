// E2E: launch the built Electron app (manager-game shell), run a stub match in a
// separate process, and screenshot the key screens. Run under a virtual display:
//   xvfb-run -a node test/e2e.electron.test.mjs   (after `npm run build`)
// Writes PNGs to apps/desktop/docs/.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const OUT = path.join(appDir, 'docs');
fs.mkdirSync(OUT, { recursive: true });
const requireApp = createRequire(path.join(appDir, 'package.json'));
const electronPath = requireApp('electron');

async function main() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [
      path.join(appDir, 'out/main/index.js'),
      '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
    ],
    cwd: appDir,
    env: {
      ...process.env,
      PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'),
      PV_REPO_ROOT: path.resolve(appDir, '..', '..'),
      PV_MATCH_SCRIPT: path.join(appDir, 'scripts', 'run-match.mts'),
      PV_SESSION_SCRIPT: path.join(appDir, 'scripts', 'match-session.mts'),
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

  // shell + Match Day (default route)
  await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-shell.png') });

  // run a stub match (separate process → IPC → replay) and confirm it loads
  await page.getByTestId('run-match').click();
  // match-runner subprocess (npx tsx) + full map can take a while to cold-start
  await page.waitForSelector('.rv-src-simulated', { timeout: 90000 });
  assert.ok(/SIMULATED/.test(await page.locator('.rv-src-simulated').innerText()), 'simulated replay loaded');
  // real match scoreboard rendered (first-to-13)
  await page.waitForSelector('[data-testid="scoreboard"]', { timeout: 5000 });
  const sb = await page.getByTestId('scoreboard').innerText();
  assert.ok(/\d+/.test(sb), 'scoreboard shows a score');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, 'desktop-matchday.png') });

  // Fog-of-war on the LIVE match — the match-runner records perception, so the fog
  // controls appear with no demo. Render one team's view: observed enemies, ghosts,
  // sound zones, belief heatmap.
  await page.waitForSelector('[data-testid="fog-on"]', { timeout: 10000 });
  // Seed-42 match: team-A's richest perception frame (observed enemies + belief) is
  // ~223.9s in (round 5). Deterministic, so this consistently shows contacts.
  await page.locator('.rv-scrub').fill('223900');
  await page.getByTestId('fog-belief').check();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'desktop-fog.png') });
  // toggle belief off → fog without heatmap, and switch POV to the other team
  await page.getByTestId('fog-belief').uncheck();
  await page.selectOption('[data-testid="fog-pov"]', '1');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-fog-pov.png') });

  // Post-match Review tab: round strip, economy timeline, decisions, MVP, ground truth.
  await page.getByTestId('tab-review').click();
  await page.waitForSelector('[data-testid="review-panel"]', { timeout: 10000 });
  assert.ok(await page.getByTestId('rev-strip').isVisible(), 'round-result strip rendered');
  assert.ok(await page.getByTestId('rev-econ').isVisible(), 'economy timeline rendered');
  await page.waitForSelector('[data-testid="rev-decision"]', { timeout: 10000 }); // traces loaded
  const mvp = await page.getByTestId('rev-mvp').innerText();
  assert.ok(/MVP/.test(mvp) && /\d/.test(mvp), 'MVP shows a stat'); // language-agnostic
  await page.waitForTimeout(1200); // ground-truth viewer paints
  await page.screenshot({ path: path.join(OUT, 'desktop-review.png') });

  // Interactive mode: round-by-round with a tactical timeout + coach orders, and
  // verify the order reaches the match (timeout log) in the post-match Review.
  await page.getByTestId('tab-match').click();
  await page.getByTestId('mode-interactive').click();
  await page.getByTestId('start-interactive').click();
  await page.waitForSelector('[data-testid="session-bar"]', { timeout: 60000 });
  await page.getByTestId('next-round').click();            // play round 1
  await page.waitForTimeout(1500);
  await page.getByTestId('call-timeout').click();          // tactical timeout
  await page.waitForSelector('[data-testid="orders-panel"]', { timeout: 10000 });
  await page.selectOption('[data-testid="ord-strategy"]', 'aExecute').catch(() => {});
  await page.selectOption('[data-testid="ord-economy"]', 'force').catch(() => {});
  await page.screenshot({ path: path.join(OUT, 'desktop-orders.png') });
  await page.getByTestId('ord-confirm').click();           // issue orders
  await page.waitForTimeout(500);
  await page.getByTestId('next-round').click();            // play round 2 (orders applied)
  await page.waitForTimeout(2000);
  await page.screenshot({ path: path.join(OUT, 'desktop-interactive.png') });
  // Review shows the tactical-timeout log (proves the order reached the engine)
  await page.getByTestId('tab-review').click();
  await page.waitForSelector('[data-testid="rev-timeouts"]', { timeout: 10000 });
  const tolog = await page.getByTestId('rev-timeouts').innerText();
  assert.ok(/R2/.test(tolog), 'timeout log records the pre-round-2 order');
  await page.screenshot({ path: path.join(OUT, 'desktop-review-interactive.png') });

  // Squad (sortable table of real VCT names)
  await page.getByTestId('nav-squad').click();
  await page.waitForSelector('[data-testid="dt-row"]', { timeout: 10000 });
  await page.getByTestId('dt-row').first().click(); // open detail panel
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'desktop-squad.png') });

  // Decision Debugger (Dev) — pick the scenario with exclusions
  await page.getByTestId('nav-dev-debugger').click();
  await page.waitForSelector('[data-testid="excluded-card"]', { timeout: 10000 });
  await page.selectOption('[data-testid="trace-select"]', 'trace-scenario-04').catch(() => {});
  await page.waitForTimeout(500);
  assert.ok(/not enough time|needs|not a plantable/i.test(await page.getByTestId('excluded-card').innerText()), 'exclusion reasons visible');
  await page.screenshot({ path: path.join(OUT, 'desktop-debugger.png') });

  await app.close();
  console.log('E2E OK — screenshots in apps/desktop/docs/');
}
main().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
