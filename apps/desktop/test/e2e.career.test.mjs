// E2E for career mode: start menu → new career (profile, region + team, slot) → the board's
// question blocks Continue → answer it → Continue to the first match day → play the series through the
// engine (veto with the staff advice, every map in one go) → record it → the result is in the
// standings → the next Continue plays the other teams' series through the ENGINE in the
// background → back to the main menu and Continue reproduces the saved career exactly.
// After `npm run build`:
//   PLAYWRIGHT_REQUIRE_BASE=<dir with node_modules/playwright>/ node test/e2e.career.test.mjs
// Saves go to a temporary directory (PV_SAVES_DIR), never the user's own slots. Screenshots go to
// apps/desktop/docs/desktop-career-*.png.
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const OUT = path.join(appDir, 'docs');
fs.mkdirSync(OUT, { recursive: true });
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');
const LONG = 300000;
const SAVES = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-career-e2e-'));

async function main() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(appDir, 'out/main/index.js'), '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
    cwd: appDir,
    env: {
      ...process.env,
      PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'),
      PV_REPO_ROOT: path.resolve(appDir, '..', '..'),
      PV_MATCH_SCRIPT: path.join(appDir, 'scripts', 'run-match.mts'),
      PV_SESSION_SCRIPT: path.join(appDir, 'scripts', 'match-session.mts'),
      PV_SERIES_SCRIPT: path.join(appDir, 'scripts', 'series-session.mts'),
      PV_CAREER_SIM_SCRIPT: path.join(appDir, 'scripts', 'career-sim.mts'),
      PV_SAVES_DIR: SAVES,
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  if (process.env.PV_E2E_VERBOSE) app.process().stderr?.on('data', (d) => process.stdout.write(`[main] ${d}`));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1280, 800); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `desktop-career-${name}.png`) });

  // ── start menu: nothing runs yet ──
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  // Korean UI; the day's AI fixtures by the quick estimate until the engine step below.
  await page.evaluate(() => { localStorage.setItem('pv-lang', 'ko'); localStorage.setItem('pv-career-sim', 'quick'); });
  await page.reload();
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  assert.ok(await page.getByTestId('start-continue').isDisabled(), 'no save yet → Continue is disabled');
  assert.equal(await page.locator('[data-testid^="screen-"]').count(), 0, 'no game screen behind the start menu');
  await page.waitForTimeout(300);
  await shot('start');

  // ── new career ──
  await page.getByTestId('start-new-career').click();
  await page.getByTestId('nc-name').fill('E2E 감독');
  await page.getByTestId('nc-next').click();
  await page.waitForSelector('[data-testid="nc-teams"]', { timeout: 30000 });
  await page.getByTestId('nc-region-pacific').click();
  const firstTeam = page.locator('[data-testid^="nc-team-"]').first();
  const teamId = (await firstTeam.getAttribute('data-testid')).replace('nc-team-', '');
  await firstTeam.click();
  await page.waitForSelector('[data-testid="team-overview"]');
  const overview = await page.getByTestId('team-overview').innerText();
  assert.ok(/CA \d+/.test(overview), 'the overview shows the roster with abilities');
  await shot('team');
  await page.getByTestId('nc-next').click();
  await page.getByTestId('nc-start').click();
  await page.waitForSelector('[data-testid="home"]', { timeout: 60000 });
  const teamName = await page.getByTestId('ctx-team').innerText();
  assert.match(await page.getByTestId('home-date').innerText(), /^2026-01-05$/);
  assert.ok(fs.existsSync(path.join(SAVES, 'slot1.json')), 'the new career is saved to slot 1');

  // ── the board's question waits from day one: Continue is blocked until it is answered ──
  await page.waitForSelector('[data-testid="home-awaiting"]', { timeout: 30000 });
  assert.ok(await page.getByTestId('home-continue').isDisabled(), 'Continue waits for the answer');
  await page.getByTestId('home-go-inbox').click();
  await page.getByTestId('inbox-option-playoffs').click();
  await page.getByTestId('nav-home').click();
  await shot('home');

  // ── Continue → first match day ──
  await page.getByTestId('home-continue').click();
  await page.waitForSelector('[data-testid="home-matchday"]', { timeout: LONG });
  const matchDate = await page.getByTestId('home-date').innerText();
  assert.ok(matchDate >= '2026-02-01', `first match day is in February (${matchDate})`);
  await page.getByTestId('home-go-match').click();

  // ── the series, with the career's teams ──
  await page.waitForSelector('[data-testid="series-career-fixture"]', { timeout: 20000 });
  assert.ok(await page.getByTestId('series-team-a').isDisabled(), 'teams are fixed by the fixture');
  assert.equal(await page.locator('[data-testid="series-team-a"] option:checked').innerText(), teamName, 'our team is series team A');
  await page.getByTestId('series-start').click();
  await page.waitForSelector('[data-testid="veto-board"]', { timeout: LONG });
  const phase = () => page.getByTestId('series-screen').getAttribute('data-phase');
  while ((await phase()) === 'veto') {
    const ours = await page.getByTestId('veto-turn').getAttribute('data-step-ours');
    const before = await page.locator('[data-testid="veto-log"] .ser-logrow').count();
    if (ours === 'true') await page.getByTestId('veto-accept').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="veto-log"] .ser-logrow').length > n || document.querySelector('[data-testid="series-screen"]')?.getAttribute('data-phase') !== 'veto', before, { timeout: LONG });
  }
  while ((await phase()) === 'playing') {
    const played = await page.locator('[data-testid^="series-map-"].won, [data-testid^="series-map-"].lost').count();
    await page.getByTestId('series-quick-game').click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="series-map-"].won, [data-testid^="series-map-"].lost').length > n, played, { timeout: LONG });
  }
  await page.waitForSelector('[data-testid="series-summary"]', { timeout: 20000 });
  const a = Number(await page.getByTestId('series-score-a').innerText());
  const b = Number(await page.getByTestId('series-score-b').innerText());
  await page.getByTestId('series-career-record').click();
  await page.waitForSelector('[data-testid="home"]', { timeout: 20000 });

  // ── the result is in the standings ──
  await page.getByTestId('nav-standings').click();
  const row = page.getByTestId(`stand-row-${teamId}`);
  const cells = await row.locator('td').allInnerTexts();
  assert.equal(cells[2], '1', `${teamName} has played one series (row: ${cells.join(' | ')})`);
  assert.equal(cells[a > b ? 3 : 4], '1', 'the win / loss is counted');
  assert.equal(cells[5], `${a}–${b}`, 'maps won–lost');
  await shot('standings');

  // ── the next Continue plays the rest of the day's fixtures through the engine in the background ──
  await page.evaluate(() => localStorage.setItem('pv-career-sim', 'engine'));
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-continue').click();
  await page.waitForSelector('[data-testid="career-progress"]', { timeout: 60000 });
  await shot('sim');
  await page.waitForSelector('[data-testid="home-matchday"]', { timeout: LONG * 3 });
  assert.equal(await page.getByTestId('home-notice').count(), 0, 'no engine fallback was needed');
  const dateAfter = await page.getByTestId('home-date').innerText();
  const saved = JSON.parse(fs.readFileSync(path.join(SAVES, 'slot1.json'), 'utf8'));
  const engineResults = saved.career.season.fixtures.filter((f) => f.result?.source === 'engine').length;
  assert.ok(engineResults >= 1, `AI series were played by the engine (${engineResults})`);
  assert.equal(saved.career.date, dateAfter, 'autosaved when Continue stopped');

  // ── main menu → Continue reproduces the save ──
  await page.getByTestId('nav-standings').click();
  const standingsBefore = await page.getByTestId('standings').innerText();
  await page.getByTestId('ctx-menu').click();
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  await page.getByTestId('start-continue').click();
  await page.waitForSelector('[data-testid="home"]', { timeout: 30000 });
  assert.equal(await page.getByTestId('home-date').innerText(), dateAfter, 'loaded on the saved day');
  await page.getByTestId('nav-standings').click();
  assert.equal(await page.getByTestId('standings').innerText(), standingsBefore, 'the loaded standings are identical');

  await app.close();
  fs.rmSync(SAVES, { recursive: true, force: true });
  console.log(`CAREER E2E OK — ${teamName}: ${a}–${b} on ${matchDate}; ${engineResults} engine-played AI series; next match day ${dateAfter}`);
}
main().catch((e) => { console.error('CAREER E2E FAILED:', e); process.exit(1); });
