// E2E (club operations only): launch the built Electron app, start a career (the club screens are
// part of a career), sign a free agent, see the wage list, set training; screenshot the club screens.
// Saves go to a temporary directory. After `npm run build`:
//   Linux (headless): xvfb-run -a node test/e2e.electron.test.mjs
//   macOS / Windows:  node test/e2e.electron.test.mjs   (opens a real window)
// Writes PNGs to apps/desktop/docs/.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import os from 'node:os';
import { clubStep, startCareer } from './e2e-club-step.mjs';

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
const SAVES = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-club-e2e-'));

async function main() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(appDir, 'out/main/index.js'), '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
    cwd: appDir,
    env: { ...process.env, PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'), PV_REPO_ROOT: path.resolve(appDir, '..', '..'), PV_SAVES_DIR: SAVES },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  // The app opens on the start menu; the club screens belong to a career.
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  await page.evaluate(() => { localStorage.setItem('pv-lang', 'ko'); localStorage.setItem('pv-career-depth', 'quick'); });
  await page.reload();
  await startCareer(page);
  const signed = await clubStep(page, OUT);
  await app.close();
  fs.rmSync(SAVES, { recursive: true, force: true });
  console.log(`E2E CLUB OK — signed ${signed}; screenshots in apps/desktop/docs/`);
}
main().catch((e) => { console.error('E2E CLUB FAILED:', e); process.exit(1); });
