// E2E for career mode with club operations: start menu → new career → the board's question blocks
// Continue → a free agent signed on a one-year contract from Transfers → a training focus and
// practice map → Continue to the first match day → a lineup that includes the new signing → the
// series through the engine (veto with the staff advice, every map in one go) → recorded (standings,
// minutes) → the next Continue plays other teams' series through the ENGINE in the background →
// the season is played to its end (quick estimate for the AI series) → the signing's contract
// expires and the season transition runs → main menu → Continue reproduces the saved career.
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
import { answerInbox, clubStep, startCareer } from './e2e-club-step.mjs';

const require = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { _electron: electron } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const appDir = path.resolve(here, '..');
const OUT = path.join(appDir, 'docs');
fs.mkdirSync(OUT, { recursive: true });
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');
const LONG = 300000;
const SAVES = fs.mkdtempSync(path.join(os.tmpdir(), 'pv-career-e2e-'));
const readSave = () => JSON.parse(fs.readFileSync(path.join(SAVES, 'slot1.json'), 'utf8')).career;

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
  const simMode = (m) => page.evaluate((v) => localStorage.setItem('pv-career-sim', v), m);

  // ── start menu: nothing runs yet ──
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  await page.evaluate(() => { localStorage.setItem('pv-lang', 'ko'); });
  await simMode('quick');
  await page.reload();
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  assert.ok(await page.getByTestId('start-continue').isDisabled(), 'no save yet → Continue is disabled');
  assert.equal(await page.locator('[data-testid^="screen-"]').count(), 0, 'no game screen behind the start menu');
  await page.waitForTimeout(300);
  await shot('start');

  // ── new career (the manager's club comes from the start menu) ──
  const { teamId, teamName } = await startCareer(page);
  assert.match(await page.getByTestId('home-date').innerText(), /^2026-01-05$/);
  assert.ok(fs.existsSync(path.join(SAVES, 'slot1.json')), 'the new career is saved to slot 1');
  assert.equal(readSave().world.club.userTeamId, teamId, 'the club layer runs for the manager\'s club');
  // The board's question waits from day one: Continue is blocked until it is answered.
  await page.waitForSelector('[data-testid="home-awaiting"]', { timeout: 30000 });
  assert.ok(await page.getByTestId('home-continue').isDisabled(), 'Continue waits for the answer');
  await page.getByTestId('home-go-inbox').click();
  await page.getByTestId('inbox-option-playoffs').click();
  await page.getByTestId('nav-home').click();
  await shot('home');

  // ── club: a free agent on a one-year contract, and the training plan ──
  const signed = await clubStep(page, OUT, { years: 1, practiceMap: true });
  const afterClub = readSave();
  const signedId = Object.keys(afterClub.world.players).find((id) => afterClub.world.players[id].handle === signed);
  assert.equal(afterClub.world.club.contracts[signedId].endSeason, afterClub.world.season, 'one-year contract ends this season');
  const plan = afterClub.world.club.training.plans[teamId];
  assert.equal(plan.teamFocus, 'tactics');
  assert.ok(plan.map, 'a practice map is set');
  await page.getByTestId('nav-home').click();

  // ── Continue → first match day ──
  await page.getByTestId('home-continue').click();
  await page.waitForSelector('[data-testid="home-matchday"]', { timeout: LONG });
  const matchDate = await page.getByTestId('home-date').innerText();
  assert.ok(matchDate >= '2026-02-01', `first match day is in February (${matchDate})`);
  const fatigueBefore = readSave().world.club.training.exposure;
  await page.getByTestId('home-go-match').click();

  // ── lineup: a hand-picked five that includes the new signing ──
  await page.waitForSelector('[data-testid="career-lineup"]', { timeout: 20000 });
  const signedRow = page.locator('[data-testid^="lineup-row-"]', { hasText: signed });
  assert.equal(await signedRow.count(), 1, 'the new signing is in the squad list');
  if (!(await signedRow.locator('input[type=checkbox]').isChecked())) {
    await page.locator('[data-testid^="lineup-row-"]:has(input:checked)').first().click(); // make room
    await signedRow.click();
  }
  assert.equal(await page.locator('[data-testid^="lineup-row-"] input:checked').count(), 5, 'five are picked');
  const lineupIds = await page.locator('[data-testid^="lineup-row-"]:has(input:checked)').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid').replace('lineup-row-', '')));
  assert.ok(lineupIds.includes(signedId), 'the signing is in the chosen five');
  await shot('lineup');
  await page.getByTestId('lineup-confirm').click();

  // ── the series, with the career's teams, the chosen five and our map practice ──
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

  // ── the result is in the standings, the minutes and K/D with the players who played ──
  await page.getByTestId('nav-standings').click();
  const cells = await page.getByTestId(`stand-row-${teamId}`).locator('td').allInnerTexts();
  assert.equal(cells[2], '1', `${teamName} has played one series (row: ${cells.join(' | ')})`);
  assert.equal(cells[a > b ? 3 : 4], '1', 'the win / loss is counted');
  assert.equal(cells[5], `${a}–${b}`, 'maps won–lost');
  await shot('standings');
  const afterMatch = readSave();
  const line = afterMatch.stats[signedId];
  assert.ok(line && line.maps === a + b, `the signing played ${a + b} maps (${JSON.stringify(line)})`);
  assert.ok(line.kills + line.deaths > 0, 'per-player kills/deaths came from the engine');
  assert.ok(afterMatch.world.club.training.exposure[signedId].fatigue >= (fatigueBefore[signedId]?.fatigue ?? 0.2), 'the maps added fatigue');
  for (const id of lineupIds) assert.ok(afterMatch.stats[id]?.maps === a + b, 'the whole chosen five played every map');

  // ── the next Continue plays the rest of the day's fixtures through the engine in the background ──
  await simMode('engine');
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-continue').click();
  await page.waitForSelector('[data-testid="career-progress"]', { timeout: 60000 });
  await shot('sim');
  await page.waitForSelector('[data-testid="home-matchday"], [data-testid="home-awaiting"]', { timeout: LONG * 3 });
  assert.equal(await page.getByTestId('home-notice').count(), 0, 'no engine fallback was needed');
  const engineResults = readSave().season.fixtures.filter((f) => f.result?.source === 'engine').length;
  assert.ok(engineResults >= 1, `AI series were played by the engine (${engineResults})`);

  // ── play the season out: instant results for our matches, quick estimate for the AI series ──
  await simMode('quick');
  let seasonEnd = false;
  for (let i = 0; i < 80 && !seasonEnd; i++) {
    if (await page.getByTestId('home-awaiting').count()) { await answerInbox(page); continue; }
    if (await page.getByTestId('home-matchday').count()) {
      await page.getByTestId('home-go-match').click();
      await page.waitForSelector('[data-testid="career-lineup"]');
      await page.getByTestId('career-instant').click();
      await page.waitForSelector('[data-testid="home"]', { timeout: 20000 });
      continue;
    }
    if (await page.getByTestId('home-season-end').count()) { seasonEnd = true; break; }
    await page.getByTestId('home-continue').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="home-matchday"], [data-testid="home-awaiting"], [data-testid="home-season-end"]'), null, { timeout: LONG });
  }
  assert.ok(seasonEnd, 'the season reached its last day');
  const endSave = readSave();
  assert.ok(endSave.season.fixtures.every((f) => !!f.result), 'every fixture of the season was played');
  assert.ok(endSave.world.club.contracts[signedId], 'the signing is still under contract on the last day');
  await shot('season-end');

  // ── the season ends: contracts expire, the squad is left alone otherwise, the next season opens ──
  const rosterBefore = new Set([...endSave.world.teams[teamId].roster, ...endSave.world.teams[teamId].academy]);
  await page.getByTestId('home-continue').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="home-matchday"], [data-testid="home-awaiting"]') || /2027/.test(document.querySelector('[data-testid="home-date"]')?.textContent ?? ''), null, { timeout: LONG });
  const next = readSave();
  assert.equal(next.world.season, endSave.world.season + 1, 'the next season opened');
  assert.ok(!next.world.teams[teamId].roster.includes(signedId), 'the one-year signing left when the contract expired');
  assert.ok(next.world.club.transfers.some((t) => t.playerId === signedId && t.kind === 'expiry'), 'the expiry is recorded');
  const expiredMsg = next.inbox.find((m) => m.source === 'club' && /Contracts expired/.test(m.text?.en?.title ?? ''));
  assert.ok(expiredMsg && expiredMsg.text.en.body.includes(signed), 'the inbox tells us who left');
  for (const id of [...next.world.teams[teamId].roster, ...next.world.teams[teamId].academy]) assert.ok(rosterBefore.has(id), 'no player was added by the season loop');
  assert.equal(next.history.length, 1, 'the season is in the history');

  // ── main menu → Continue reproduces the save ──
  await page.getByTestId('nav-standings').click();
  const standingsBefore = await page.getByTestId('standings').innerText();
  const dateNow = await page.getByTestId('ctx-date').innerText();
  await page.getByTestId('ctx-menu').click();
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  await page.getByTestId('start-continue').click();
  await page.waitForSelector('[data-testid="home"]', { timeout: 30000 });
  assert.equal(await page.getByTestId('ctx-date').innerText(), dateNow, 'loaded on the saved day');
  await page.getByTestId('nav-standings').click();
  assert.equal(await page.getByTestId('standings').innerText(), standingsBefore, 'the loaded standings are identical');

  await app.close();
  fs.rmSync(SAVES, { recursive: true, force: true });
  console.log(`CAREER E2E OK — ${teamName}: signed ${signed}, played ${a}–${b} on ${matchDate} with a chosen five; ${engineResults} engine-played AI series; season ${endSave.world.season} played out, contract expired, season ${next.world.season} open`);
}
main().catch((e) => { console.error('CAREER E2E FAILED:', e); process.exit(1); });
