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
// Autosave is asynchronous: the screen can show a new state a moment before the save file has it.
// Poll the save until it reaches the state the screen shows (or time out and return the last read).
async function saveWhen(pred, timeoutMs = 15000) {
  const t0 = Date.now();
  let last = null;
  while (Date.now() - t0 < timeoutMs) {
    try { last = readSave(); if (pred(last)) return last; } catch { /* mid-write */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  return last ?? readSave();
}

const T0 = Date.now();
const mark = (label) => console.log(`[${Math.round((Date.now() - T0) / 1000)}s] ${label}`);

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
  page.on('crash', () => console.log('[page] renderer crashed'));
  page.on('close', () => console.log('[page] window closed'));
  app.on('close', () => console.log('[app] closed'));
  if (process.env.PV_E2E_VERBOSE) app.process().stderr?.on('data', (d) => process.stdout.write(`[main] ${d}`));
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].setContentSize(1280, 800); });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `desktop-career-${name}.png`) });
  const simMode = (m) => page.evaluate((v) => localStorage.setItem('pv-career-depth', v), m); // quick | league | full

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
  mark('career started');
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
  mark('club step done');
  const afterClub = readSave();
  const signedId = Object.keys(afterClub.world.players).find((id) => afterClub.world.players[id].handle === signed);
  assert.equal(afterClub.world.club.contracts[signedId].endSeason, afterClub.world.season, 'one-year contract ends this season');
  const plan = afterClub.world.club.training.plans[teamId];
  assert.equal(plan.teamFocus, 'tactics');
  assert.ok(plan.map, 'a practice map is set');
  await page.getByTestId('nav-home').click();

  // ── scouting: a scout on the region's youth; another club's player is seen as ranges ──
  await page.getByTestId('nav-scouting').click();
  await page.waitForSelector('[data-testid="career-screen"]', { timeout: 20000 });
  await page.getByTestId('scout-tab-assign').click();
  await page.waitForSelector('[data-testid="assign-panel"]', { timeout: 10000 });
  await page.selectOption('[data-testid="assign-kind-0"]', 'youth');
  await page.getByTestId('assign-save-0').click();
  await page.waitForFunction(() => /유스|Youth/.test(document.querySelector('[data-testid="assign-current-0"]')?.textContent ?? ''), null, { timeout: 10000 });
  const scouted = await saveWhen((c) => (c.world.scouting?.assignments ?? []).some((x) => x.kind === 'youth'));
  assert.ok(scouted.world.scouting.assignments.some((x) => x.kind === 'youth'), 'the assignment is saved');
  await shot('scouting-assign');
  await page.getByTestId('career-tab-free').click();
  await page.getByTestId('dt-row').first().click();
  await page.waitForSelector('[data-testid="player-detail"] [data-testid="knowledge-pct"]', { timeout: 10000 });
  assert.ok(await page.locator('[data-testid="player-detail"] [data-testid="attr-range"]').count() >= 5, 'attributes are shown as ranges');
  assert.equal(await page.locator('[data-testid="player-detail"] [data-testid="knowledge-own"]').count(), 0, 'not our player');
  await shot('scouting-player');
  await page.getByTestId('nav-home').click();

  // ── Continue → first match day ──
  // (an AI club may bid for one of our players on the way: that is a question, answered by rejecting)
  const toMatchDay = async () => {
    for (let i = 0; i < 20; i++) {
      if (await page.getByTestId('home-matchday').count()) return;
      if (await page.getByTestId('home-awaiting').count()) { await answerInbox(page); continue; }
      await page.getByTestId('home-continue').click();
      await page.waitForSelector('[data-testid="home-matchday"], [data-testid="home-awaiting"]', { timeout: LONG });
    }
    throw new Error('no match day reached');
  };
  await toMatchDay();
  mark('first match day reached');
  const matchDate = await page.getByTestId('home-date').innerText();
  assert.ok(matchDate >= '2026-01-05' && matchDate < '2026-03-01', `first match day is in the Kickoff window (${matchDate})`); // the circuit calendar starts with Kickoff in January
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
  mark('veto board');
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
  mark('series recorded');
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
  await simMode('league'); // the engine plays the other series of our league
  await page.getByTestId('nav-home').click();
  await page.getByTestId('home-continue').click();
  await page.waitForSelector('[data-testid="career-progress"]', { timeout: 60000 });
  mark('engine continue started');
  await shot('sim');
  // Bounded: this Continue plays one week of our league's AI series through the engine (≈ 5 series,
  // 3–5 s each; the host kills a series stuck for 60 s and the day falls back to the quick estimate).
  // A wait of minutes means something hung — say what the screen was doing.
  await page.waitForSelector('[data-testid="home-matchday"], [data-testid="home-awaiting"]', { timeout: 240000 }).catch(async (e) => {
    const txt = await page.getByTestId('career-progress').innerText().catch(() => '(no progress box)');
    throw new Error(`the engine Continue did not stop within 4 min — progress box: ${txt.replace(/\s+/g, ' ')} — ${e.message}`);
  });
  mark('engine continue stopped');
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
  mark('season end reached');
  const endSave = await saveWhen((c) => c.season.fixtures.every((f) => !!f.result));
  const worldFixtures = [...endSave.season.fixtures, ...endSave.others.flatMap((l) => l.fixtures), ...endSave.circuit.events.flatMap((e) => e.fixtures)];
  assert.ok(worldFixtures.every((f) => !!f.result), 'every fixture of the world was played: four leagues, Masters 1/2 and Champions');
  assert.equal(endSave.others.length, 3, 'the other three regions ran in parallel');
  assert.ok(endSave.circuit.events.every((e) => e.champion && e.teams.length >= 12), 'the three international events were played');
  assert.equal(endSave.inbox.filter((m) => m.key === 'circuit.draw').length, 3, 'a draw message for each international event');
  assert.ok(endSave.world.club.contracts[signedId], 'the signing is still under contract on the last day');
  await shot('season-end');
  // Mondays have passed (the circuit's first match day comes before the first one): the scouts
  // have filed reports.
  await page.getByTestId('nav-scouting').click();
  await page.getByTestId('scout-tab-reports').click();
  await page.waitForSelector('[data-testid="report-table"] [data-testid="dt-row"]', { timeout: 10000 });
  await shot('scouting-reports');
  // The circuit on screen: an international event's double-elimination bracket and the points race.
  await page.getByTestId('nav-standings').click();
  await page.getByTestId('stand-champions').click();
  await page.waitForSelector('[data-testid="de-upper"]', { timeout: 10000 });
  assert.equal(await page.locator('[data-testid="de-lower"] [data-testid^="bracket-"]').count(), 6, 'lower bracket: 2 + 2 + 1 + 1 series');
  assert.equal(await page.locator('[data-testid^="intl-group-"]').count(), 4, 'four groups');
  await shot('champions');
  await page.getByTestId('stand-points').click();
  assert.equal(await page.locator('[data-testid^="points-"]:not([data-testid="points-race"])').count(), 4, 'a points table per region');
  await page.getByTestId('nav-home').click();

  // ── the season ends: contracts expire, the squad is left alone otherwise, the next season opens ──
  const rosterBefore = new Set([...endSave.world.teams[teamId].roster, ...endSave.world.teams[teamId].academy]);
  await page.getByTestId('home-continue').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="home-matchday"], [data-testid="home-awaiting"]') || /2027/.test(document.querySelector('[data-testid="home-date"]')?.textContent ?? ''), null, { timeout: LONG });
  const next = await saveWhen((c) => c.world.season === endSave.world.season + 1);
  assert.equal(next.world.season, endSave.world.season + 1, 'the next season opened');
  assert.ok(!next.world.teams[teamId].roster.includes(signedId), 'the one-year signing left when the contract expired');
  assert.ok(next.world.club.transfers.some((t) => t.playerId === signedId && t.kind === 'expiry'), 'the expiry is recorded');
  const expiredMsg = next.inbox.find((m) => m.source === 'club' && /Contracts expired/.test(m.text?.en?.title ?? ''));
  assert.ok(expiredMsg && expiredMsg.text.en.body.includes(signed), 'the inbox tells us who left');
  for (const id of [...next.world.teams[teamId].roster, ...next.world.teams[teamId].academy]) assert.ok(rosterBefore.has(id), 'no player was added by the season loop');
  assert.equal(next.history.length, 1, 'the season is in the history');

  // ── our squad after a season: each player's development history ──
  await page.getByTestId('nav-scouting').click();
  await page.getByTestId('scout-tab-club').click();
  await page.waitForSelector('[data-testid="club-youth-table"] [data-testid="dt-row"]', { timeout: 10000 });
  await page.getByTestId('dt-row').first().click();
  await page.waitForSelector('[data-testid="player-detail"] [data-testid="dev-chart"]', { timeout: 10000 });
  assert.ok(await page.locator('[data-testid="player-detail"] [data-testid="knowledge-own"]').count() === 1, 'our own player');
  assert.ok(await page.locator('[data-testid="own-morale"]').count() === 1, 'morale is shown');
  await shot('development');

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
