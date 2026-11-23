// E2E: launch the built Electron app (manager-game shell), run real matches in a
// separate process, and screenshot the key screens. After `npm run build`:
//   Linux (headless): xvfb-run -a node test/e2e.electron.test.mjs
//   macOS / Windows:  node test/e2e.electron.test.mjs   (opens a real window)
// Writes PNGs to apps/desktop/docs/.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
// (club operations are covered by e2e.club / e2e.career: they need a career)

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
    args: [
      path.join(appDir, 'out/main/index.js'),
      '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist', '--disable-gpu-sandbox',
    ],
    cwd: appDir,
    env: {
      ...process.env,
      PV_TRACES_DIR: path.join(appDir, 'test/fixtures/traces'),
      // optional local assets (real map mesh, banners) are never present in CI: keep runs independent of them
      PV_MAP_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'),
      PV_BANNER_ASSETS_DIR: path.join(appDir, 'test/fixtures/no-local-assets'),
      PV_REPO_ROOT: path.resolve(appDir, '..', '..'),
      PV_MATCH_SCRIPT: path.join(appDir, 'scripts', 'run-match.mts'),
      PV_SESSION_SCRIPT: path.join(appDir, 'scripts', 'match-session.mts'),
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));

  // shell + Match Day (default route). The language persists in localStorage across
  // launches, so pin the default (Korean) first — screenshots and docs are Korean.
  // The app opens on the start menu; the match engine and dev tools are under Quick Match.
  const enterSandbox = async () => {
    await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
    await page.getByTestId('start-quick-match').click();
    await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });
  };
  await enterSandbox();
  await page.evaluate(() => localStorage.setItem('pv-lang', 'ko'));
  await page.reload();
  await enterSandbox();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-shell.png') });
  // The live view remembers its mode; start from the default (tactical map) on every run.
  await page.evaluate(() => localStorage.removeItem('pv-matchday-view'));

  // run a stub match (separate process → IPC → replay) and confirm it loads
  await page.getByTestId('run-match').click();
  // the wait is covered by the match load screen: map name, both line-ups, progress
  await page.waitForSelector('[data-testid="loading-screen"][data-layout="match"]', { timeout: 15000 });
  assert.equal(await page.locator('[data-testid="matchload-ally"] li').count(), 5, 'load screen lists our five');
  assert.equal(await page.locator('[data-testid="matchload-enemy"] li').count(), 5, 'load screen lists their five');
  // match-runner subprocess (npx tsx) + full map can take a while to cold-start
  await page.waitForSelector('.rv-src-simulated', { timeout: 90000 });
  assert.ok(/SIMULATED/.test(await page.locator('.rv-src-simulated').innerText()), 'simulated replay loaded');
  assert.equal(await page.locator('[data-testid="loading-screen"]').count(), 0, 'the load screen closes once the match is on screen');
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
  // The live view scrubs one round at a time: jump to round 5 and seek 12 s in (first contact).
  await page.getByTestId('round-chip-5').click();
  const r5Start = await page.locator('.rv-scrub').evaluate((el) => Number(el.min));
  await page.locator('.rv-scrub').fill(String(r5Start + 12000));
  await page.getByTestId('fog-belief').check();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(OUT, 'desktop-fog.png') });
  // toggle belief off → fog without heatmap, and switch POV to the other team
  await page.getByTestId('fog-belief').uncheck();
  await page.selectOption('[data-testid="fog-pov"]', '1');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-fog-pov.png') });

  // Navigation debug (developer view): the walkable floor as the engine's roadmap knows it, the
  // zone graph with every zone's connection, and per player the destination, planned waypoints,
  // walked trace, replans, failures and WHY that route (order + route preference).
  await page.selectOption('[data-testid="fog-pov"]', '0');
  await page.getByTestId('round-chip-3').click();
  const r3Start = await page.locator('.rv-scrub').evaluate((el) => Number(el.min));
  await page.locator('.rv-scrub').fill(String(r3Start + 9000));
  await page.getByTestId('debug-graph').check();
  await page.waitForSelector('[data-testid="nav-debug-panel"]', { timeout: 5000 });
  const navTxt = await page.getByTestId('nav-debug-panel').innerText();
  assert.ok(/22\/22/.test(await page.getByTestId('nav-debug-zones').innerText()), 'every Ascent zone is connected to the floor');
  assert.equal(await page.locator('[data-testid^="nav-debug-row-"]').count(), 5, 'one row per player of the viewed team');
  assert.ok(/route/.test(navTxt) && /→/.test(navTxt), 'each row says why: order → goal · route preference');
  assert.ok(/\d+ m · \d+(\.\d)? s/.test(navTxt), 'planned length and time are shown');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(OUT, 'desktop-nav-debug.png') });
  await page.getByTestId('debug-graph').uncheck();
  assert.equal(await page.getByTestId('nav-debug-panel').count(), 0, 'the overlay is off by default and goes away');

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

  // Round decisions (engine RoundRecord.decisions): one note per team per round.
  await page.waitForSelector('[data-testid="rev-decisions-panel"]', { timeout: 10000 });
  assert.equal(await page.getByTestId('dec-none').count(), 0, 'the match-runner emitted decisions');
  const nRounds = await page.locator('[data-testid="rev-strip"] .rev-rcell').count();
  assert.equal(await page.locator('[data-testid^="dec-pick-"]').count(), nRounds, 'one decision note per round');
  assert.ok(await page.getByTestId('dec-summary').isVisible(), 'adaptation summary rendered');
  // Round 1 is shown first: both teams have a call, and nobody has a read yet → flagged "no evidence".
  assert.equal(await page.getByTestId('dec-round').getAttribute('data-round'), '1');
  assert.equal(await page.getByTestId('dec-call').count(), 2, 'both teams show their call');
  assert.equal(await page.locator('[data-testid="dec-read"][data-used="true"][data-level="none"]').count(), 2, 'round-1 reads are marked as having no evidence');
  // Walk the rounds: plan revisions carry a round clock, and reads gain confidence as the match goes on.
  let sawRevision = false; let sawBackedRead = false; let lowRound = null;
  for (let i = 1; i <= nRounds; i++) {
    await page.getByTestId(`dec-pick-${i}`).click();
    assert.equal(await page.getByTestId('dec-round').getAttribute('data-round'), String(i));
    assert.ok(await page.getByTestId('dec-team-A').isVisible() && await page.getByTestId('dec-team-B').isVisible(), `R${i} shows both teams`);
    if (await page.getByTestId('dec-revision').count() > 0) {
      sawRevision = true;
      assert.ok(/\d:\d\d/.test(await page.getByTestId('dec-revision').first().innerText()), 'revision shows its round clock');
    }
    if (await page.locator('[data-testid="dec-read"][data-used="true"]:is([data-level="medium"],[data-level="high"])').count() > 0) sawBackedRead = true;
    if (lowRound == null && await page.locator('[data-testid="dec-read"][data-used="true"][data-level="low"]').count() > 0) lowRound = i;
  }
  assert.ok(sawRevision, 'at least one mid-round plan revision is shown');
  assert.ok(sawBackedRead, 'reads reach medium+ confidence later in the match');
  const decTxt = await page.getByTestId('rev-decisions-panel').innerText();
  assert.ok(/라운드별 판단/.test(decTxt) && /오프닝 콜/.test(decTxt), 'decisions view renders in Korean by default');
  assert.ok(!/\{\w+\}/.test(decTxt) && !/(rev\.dec|ostrat|conf)\.[a-z]/i.test(decTxt), 'no unresolved i18n keys or placeholders');
  // Screenshot an early round, where the read is still thin (low confidence is visibly weak).
  await page.getByTestId(`dec-pick-${lowRound ?? 2}`).click();
  await page.getByTestId('dec-round').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'desktop-review-decisions.png') });

  // Pre-match options: opponent memory off reaches the engine → no reads, and the Review says so.
  await page.getByTestId('tab-match').click();
  await page.getByTestId('match-options-toggle').click();
  await page.getByTestId('opt-memory').uncheck();
  await page.getByTestId('opt-throw-B').fill('0.02');
  assert.equal(await page.getByTestId('match-options-changed').count(), 1, 'changed options are flagged');
  await page.screenshot({ path: path.join(OUT, 'desktop-match-options.png') });
  await page.getByTestId('run-match').click();
  await page.waitForFunction(() => !document.querySelector('[data-testid="run-match"]')?.hasAttribute('disabled'), null, { timeout: 90000 });
  await page.getByTestId('tab-review').click();
  await page.waitForSelector('[data-testid="dec-memory-off"]', { timeout: 10000 });
  assert.equal(await page.getByTestId('dec-read-off').count(), 2, 'both teams show "no read" with memory off');
  assert.equal(await page.getByTestId('dec-read').count(), 0, 'no read estimates are shown with memory off');
  await page.getByTestId('tab-match').click();
  await page.getByTestId('opt-reset').click();
  assert.equal(await page.getByTestId('match-options-changed').count(), 0, 'reset returns to the defaults');
  await page.getByTestId('match-options-toggle').click();

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
  // rounds streamed through the session carry their decisions too
  assert.equal(await page.locator('[data-testid^="dec-pick-"]').count(), 2, 'both played rounds have decision notes');
  await page.screenshot({ path: path.join(OUT, 'desktop-review-interactive.png') });
  await page.getByTestId('session-stop').click().catch(() => {});

  // Squad (sortable table of real VCT names)
  await page.getByTestId('nav-squad').click();
  await page.waitForSelector('[data-testid="dt-row"]', { timeout: 10000 });
  await page.getByTestId('dt-row').first().click(); // open detail panel
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(OUT, 'desktop-squad.png') });

  // Scouting · career world: generated prospects (marked), one season advance, player detail.
  await page.getByTestId('nav-scouting').click();
  await page.waitForSelector('[data-testid="career-screen"]', { timeout: 10000 });
  await page.getByTestId('career-reset').click();
  await page.waitForSelector('[data-testid="dt-row"]', { timeout: 10000 });
  assert.ok(/2026/.test(await page.getByTestId('career-season').innerText()), 'a fresh world opens in 2026');
  assert.ok(await page.locator('[data-testid="dt-row"] [data-testid="gen-tag"]').count() > 0, 'new prospects are marked as generated');
  await page.getByTestId('career-advance').click();
  await page.waitForFunction(() => /2027/.test(document.querySelector('[data-testid="career-season"]')?.textContent ?? ''), null, { timeout: 15000 });
  assert.ok(await page.locator('[data-testid="dt-row"]').count() > 0, 'the 2027 class is listed');
  await page.getByTestId('dt-row').first().click();
  await page.waitForSelector('[data-testid="player-detail"] [data-testid="ability-estimate"]', { timeout: 5000 });
  await page.getByTestId('career-tab-staff').click();
  assert.ok(await page.locator('[data-testid="dt-row"]').count() > 0, 'staff are listed');
  await page.getByTestId('career-reset').click(); // leave a fresh world behind

  // Club operations belong to a career: see test:e2e:club / test:e2e:career.

  // Decision Debugger (Dev) — pick the scenario with exclusions
  await page.getByTestId('nav-dev-debugger').click();
  await page.waitForSelector('[data-testid="excluded-card"]', { timeout: 10000 });
  await page.selectOption('[data-testid="trace-select"]', 'trace-scenario-04').catch(() => {});
  await page.waitForTimeout(500);
  assert.ok(/not enough time|needs|not a plantable/i.test(await page.getByTestId('excluded-card').innerText()), 'exclusion reasons visible');
  await page.screenshot({ path: path.join(OUT, 'desktop-debugger.png') });

  // English: the decisions view is fully localised (revision reasons stay engine English in both).
  await page.getByTestId('nav-about').click();
  await page.getByTestId('lang-en').click();
  // loading banner: the player's choice is used by the next load screen
  await page.waitForSelector('[data-testid="banner-picker"]', { timeout: 5000 });
  assert.ok(await page.locator('[data-testid="banner-picker"] [role="radio"]').count() >= 4, 'built-in banners are offered');
  await page.getByTestId('banner-prism').click();
  assert.equal(await page.getByTestId('banner-prism').getAttribute('aria-checked'), 'true', 'banner choice is selected');
  assert.equal(await page.locator('[data-testid="banner-sound"]').count(), 0, 'no sound settings without a banner pack that has sounds');
  await page.getByTestId('nav-match-day').click();
  await page.getByTestId('run-match').click();
  await page.waitForSelector('[data-testid="loading-screen"][data-banner="prism"]', { timeout: 15000 });
  await page.waitForSelector('[data-testid="scoreboard"]', { timeout: 90000 });
  await page.getByTestId('tab-review').click();
  await page.waitForSelector('[data-testid="rev-decisions-panel"]', { timeout: 10000 });
  const enTxt = await page.getByTestId('rev-decisions-panel').innerText();
  assert.ok(/round decisions/i.test(enTxt) && /opening call/i.test(enTxt), 'decisions view renders in English');
  assert.ok(!/[\uAC00-\uD7A3]/.test(enTxt), 'no Korean left in the English decisions view');
  await page.getByTestId('dec-pick-5').click();
  await page.getByTestId('dec-round').evaluate((el) => el.scrollIntoView({ block: 'start' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(OUT, 'desktop-review-decisions-en.png') });
  // restore the default language (it persists in localStorage across launches)
  await page.getByTestId('nav-about').click();
  await page.getByTestId('lang-ko').click();
  await page.getByTestId('banner-standard').click();

  await app.close();
  console.log('E2E OK — screenshots in apps/desktop/docs/');
}
main().catch((e) => { console.error('E2E FAILED:', e); process.exit(1); });
