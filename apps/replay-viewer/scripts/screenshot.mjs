// Playwright screenshots of the built viewer: synthetic fixture + (if present) a
// locally-generated real-sample replay. Serves dist/ via `vite preview`.
//
//   npm run build && node scripts/screenshot.mjs
//
// Writes PNGs to the path given by OUT_DIR (default apps/replay-viewer/docs).
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const app = path.resolve(here, '..');
const OUT = process.env.OUT_DIR || path.join(app, 'docs');
const PORT = 4188;
fs.mkdirSync(OUT, { recursive: true });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: app, stdio: 'inherit' });
const base = `http://127.0.0.1:${PORT}`;

async function waitServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(base); if (r.ok) return; } catch { /* retry */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('preview server did not start');
}

async function shoot(page, url, outFile, label) {
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="pixi-stage"] canvas', { timeout: 15000 });
  // let the minimap fetch + first frame settle
  await page.waitForTimeout(2500);
  await page.screenshot({ path: outFile });
  console.error(`shot ${label}: ${outFile}`);
}

try {
  await waitServer();
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 }, deviceScaleFactor: 2 });

  // seek a little into playback so player dots are spread, not stacked at spawn
  await shoot(page, `${base}/?t=15000`, path.join(OUT, 'screenshot-synthetic.png'), 'synthetic');

  // real sample, only if it was generated locally (not committed)
  const realFixture = path.join(app, 'public', 'fixtures', 'real-ascent.local.json');
  if (fs.existsSync(realFixture)) {
    await shoot(page, `${base}/?replay=/fixtures/real-ascent.local.json&t=12000`, path.join(OUT, 'screenshot-real.png'), 'real');
  } else {
    console.error('(no real-ascent.local.json — skipping real screenshot; generate with gen-real-replay.ts)');
  }
  await browser.close();
} finally {
  server.kill('SIGTERM');
}
