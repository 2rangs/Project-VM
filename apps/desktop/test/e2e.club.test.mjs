// E2E (club operations only): launch the built Electron app (manager-game shell), run real matches in a
// separate process, and screenshot the key screens. After `npm run build`:
//   Linux (headless): xvfb-run -a node test/e2e.electron.test.mjs
//   macOS / Windows:  node test/e2e.electron.test.mjs   (opens a real window)
// Writes PNGs to apps/desktop/docs/.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { clubStep } from './e2e-club-step.mjs';

// Playwright is not a dependency of this app: point PLAYWRIGHT_REQUIRE_BASE at any
// directory whose node_modules has `playwright` (no browser download is needed).
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
    args: [path.join(appDir, 'out/main/index.js'), '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
    cwd: appDir,
    env: { ...process.env, PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'), PV_REPO_ROOT: path.resolve(appDir, '..', '..') },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });
  await page.evaluate(() => localStorage.setItem('pv-lang', 'ko'));
  await page.reload();
  await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });
  const signed = await clubStep(page, OUT);
  await app.close();
  console.log(`E2E CLUB OK — signed ${signed}; screenshots in apps/desktop/docs/`);
}
main().catch((e) => { console.error('E2E CLUB FAILED:', e); process.exit(1); });
