// E2E: launch the built Electron app, exercise the three screens, run the stub
// simulation end-to-end (separate process → IPC → Replay), and screenshot each.
// Run under a virtual display:  xvfb-run -a node test/e2e.electron.test.mjs
// (requires `npm run build` first). Writes PNGs to apps/desktop/docs/.
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
const electronPath = requireApp('electron'); // path to the electron binary

async function main() {
  const app = await electron.launch({
    executablePath: electronPath,
    // SwiftShader gives PixiJS a software WebGL context under xvfb (no GPU).
    args: [
      path.join(appDir, 'out/main/index.js'),
      '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
    ],
    cwd: appDir,
    env: { ...process.env, PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces') },
  });
  app.process().stdout?.on('data', (d) => console.log(`[main:out] ${String(d).trim()}`));
  app.process().stderr?.on('data', (d) => console.log(`[main:err] ${String(d).trim()}`));
  const page = await app.firstWindow();
  page.on('console', (m) => console.log(`[renderer:${m.type()}] ${m.text()}`));
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.waitForSelector('[data-testid="tab-replay"]', { timeout: 20000 });

  // 1) Replay (default synthetic fixture)
  await page.waitForSelector('[data-testid="pixi-stage"] canvas', { timeout: 15000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT, 'desktop-replay.png') });

  // 2) Decision Debugger — pick the scenario with exclusions
  await page.getByTestId('tab-debugger').click();
  await page.waitForSelector('[data-testid="excluded-card"]', { timeout: 10000 });
  await page.selectOption('[data-testid="trace-select"]', 'trace-scenario-04').catch(() => {});
  await page.waitForTimeout(600);
  const excludedText = await page.getByTestId('excluded-card').innerText();
  assert.ok(/not enough time|needs|not a plantable/i.test(excludedText), 'exclusion reasons visible');
  await page.screenshot({ path: path.join(OUT, 'desktop-debugger.png') });

  // 3) Simulation Runner — run the stub (separate process), stream progress, finish
  await page.getByTestId('tab-simulation').click();
  await page.getByTestId('run-sim').click();
  await page.waitForFunction(
    () => document.querySelector('[data-testid="sim-log"]')?.textContent?.includes('done'),
    { timeout: 25000 },
  );
  await page.waitForSelector('[data-testid="open-sim-replay"]', { timeout: 5000 });
  await page.screenshot({ path: path.join(OUT, 'desktop-simulation.png') });

  // open the simulated result in the Replay tab and confirm it plays
  await page.getByTestId('open-sim-replay').click();
  await page.waitForSelector('.rv-src-simulated', { timeout: 10000 });
  const badge = await page.locator('.rv-src-simulated').innerText();
  assert.ok(/SIMULATED/.test(badge), 'simulated replay loaded into the viewer');
  await page.waitForTimeout(1800);
  await page.screenshot({ path: path.join(OUT, 'desktop-replay-simulated.png') });

  await app.close();
  console.log('E2E OK — screenshots in apps/desktop/docs/');
}

main().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
