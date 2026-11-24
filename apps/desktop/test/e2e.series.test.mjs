// E2E for the series flow: launch the built app, play a full best-of-three — veto with human
// choices (one of them against the staff advice) and AI replies, map 1 through Match Day in one
// go, map 2 round by round through Match Day, a third map if needed — and check the series
// summary; then the same flow in English. After `npm run build`:
//   PLAYWRIGHT_REQUIRE_BASE=<dir with node_modules/playwright>/ node test/e2e.series.test.mjs
// Writes the veto / summary screenshots to apps/desktop/docs/.
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
const electronPath = createRequire(path.join(appDir, 'package.json'))('electron');
const LONG = 240000;
const HANGUL = /[가-힣]/;

async function main() {
  const app = await electron.launch({
    executablePath: electronPath,
    args: [path.join(appDir, 'out/main/index.js'), '--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--disable-gpu-sandbox'],
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
      PV_SERIES_SCRIPT: path.join(appDir, 'scripts', 'series-session.mts'),
    },
  });
  const page = await app.firstWindow();
  page.on('pageerror', (e) => console.log(`[pageerror] ${e.message}`));
  if (process.env.PV_E2E_VERBOSE) {
    app.process().stderr?.on('data', (d) => process.stdout.write(`[main] ${d}`));
    page.on('console', (m) => { if (m.type() === 'error') console.log(`[console] ${m.text()}`); });
  }
  const resize = async (w, h) => {
    await app.evaluate(({ BrowserWindow }, s) => { BrowserWindow.getAllWindows()[0].setContentSize(s.w, s.h); }, { w, h });
    await page.waitForTimeout(400);
  };
  const phase = () => page.getByTestId('series-screen').getAttribute('data-phase');
  const logRows = () => page.locator('[data-testid="veto-log"] .ser-logrow').count();
  const seriesScore = async () => Number(await page.getByTestId('series-score-a').innerText()) + Number(await page.getByTestId('series-score-b').innerText());
  /** No card or bar spills out of its box, and the screen does not scroll sideways. */
  const assertNoOverflow = async (label) => {
    const bad = await page.evaluate(() => {
      const out = [];
      for (const el of document.querySelectorAll('.ser-card, .ser-turn, .ser-rec, .ser-detail, .ser-bar')) {
        if (el.scrollWidth > el.clientWidth + 1) out.push(`${el.className.split(' ')[0]}: ${el.scrollWidth} > ${el.clientWidth}`);
      }
      const main = document.querySelector('.maincontent');
      if (main && main.scrollWidth > main.clientWidth + 1) out.push(`maincontent scrolls sideways: ${main.scrollWidth} > ${main.clientWidth}`);
      return out;
    });
    assert.deepEqual(bad, [], `${label}: horizontal overflow`);
  };

  /** Play one whole series through the UI. Returns what happened for the assertions. */
  async function playSeries({ lang, shots }) {
    await page.getByTestId('nav-veto').click();
    await page.waitForSelector('[data-testid="series-setup"]', { timeout: 20000 });
    assert.ok(await page.getByTestId('series-options').isVisible(), 'scouting / analyst options are on the setup');
    await page.selectOption('[data-testid="series-team-a"]', { label: 'Paper Rex' });
    await page.selectOption('[data-testid="series-team-b"]', { label: 'MIBR' });
    await page.getByTestId('series-format-bo3').click();
    await page.getByTestId('series-start').click();
    await page.waitForSelector('[data-testid="veto-board"]', { timeout: LONG });
    assert.equal(await phase(), 'veto');
    assert.ok(await page.getByTestId('series-geometry-note').isVisible(), 'the Ascent-geometry note is on the veto screen');
    assert.equal(await page.locator('[data-testid^="veto-card-"]').count(), 7, 'seven map cards');
    assert.equal(await page.locator('[data-testid^="veto-mastery-us-"]').count(), 7, 'our mastery on every card');
    // Every mastery number carries its certainty level (which ones are "low" depends on the data).
    const levels = await page.locator('.ser-bar').evaluateAll((els) => els.map((e) => e.getAttribute('data-level') ?? (e.classList.contains('lvl-none') ? 'none' : '')));
    assert.ok(levels.length >= 14 && levels.every((l) => ['high', 'medium', 'low', 'none'].includes(l)), 'every mastery bar shows a certainty level');

    let humanSteps = 0; let aiSteps = 0; let againstAdvice = null; let shot = false;
    while ((await phase()) === 'veto') {
      const turn = page.getByTestId('veto-turn');
      const ours = await turn.getAttribute('data-step-ours');
      const kind = await turn.getAttribute('data-step-kind');
      const before = await logRows();
      if (ours === 'true') {
        assert.ok(await page.getByTestId('veto-recommendation').isVisible(), 'our step shows the staff advice with its reason');
        if (humanSteps === 0) {
          // First choice: deliberately NOT the advice — ban the last available non-recommended map.
          const ids = await page.locator('[data-testid^="veto-choose-"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')));
          const rec = await page.locator('.ser-card.rec').first().getAttribute('data-testid');
          const pick = ids.reverse().find((id) => id.replace('veto-choose-', 'veto-card-') !== rec);
          againstAdvice = pick.replace('veto-choose-', '');
          await page.getByTestId(pick).click();
        } else {
          await page.getByTestId('veto-accept').click();
        }
        humanSteps += 1;
      } else {
        assert.equal(await page.getByTestId('veto-recommendation').count(), 0, 'no advice / buttons on the opponent\'s step');
        assert.equal(await page.locator('[data-testid^="veto-choose-"]').count(), 0, 'maps cannot be chosen on the opponent\'s step');
        aiSteps += 1;
      }
      // the step lands in the log (the decider adds its own line right after the last ban)
      await page.waitForFunction((n) => document.querySelectorAll('[data-testid="veto-log"] .ser-logrow').length > n || document.querySelector('[data-testid="series-screen"]')?.getAttribute('data-phase') !== 'veto', before, { timeout: LONG });
      if (!shot && shots && (await phase()) === 'veto' && (await logRows()) >= 5 && (await turn.getAttribute('data-step-ours')) === 'true' && kind !== 'side') {
        shot = true;
        await resize(1280, 720); await assertNoOverflow(`${lang} 1280x720`);
        await page.screenshot({ path: path.join(OUT, shots.veto) });
        await resize(1920, 1080); await assertNoOverflow(`${lang} 1920x1080`);
        await page.screenshot({ path: path.join(OUT, shots.veto.replace('.png', '-1080p.png')) });
        await resize(1280, 800);
      }
    }
    assert.equal(humanSteps, 5, 'we made five choices in a Bo3 (ban, pick, side, ban, decider side)');
    assert.ok(aiSteps >= 4, 'the AI made the opponent\'s choices');

    // ── series scoreboard between maps ──
    await page.waitForSelector('[data-testid="series-scoreboard"]', { timeout: 20000 });
    assert.equal(await phase(), 'playing');
    assert.equal(await page.locator('[data-testid^="series-map-"]').count(), 3, 'three maps in the series');
    assert.ok(await page.getByTestId('series-geometry-note').isVisible(), 'the geometry note stays on the series screen');
    const boardTxt = await page.getByTestId('series-scoreboard').innerText();

    // Map 1: through Match Day, in one go.
    await page.getByTestId('series-open-game').click();
    await page.waitForSelector('[data-testid="series-md-banner"]', { timeout: 20000 });
    assert.ok(await page.getByTestId('team-a').isDisabled(), 'teams are fixed by the series');
    await page.getByTestId('run-match').click();
    await page.waitForSelector('[data-testid="scoreboard"]', { timeout: LONG });
    await page.getByTestId('series-return').click();
    await page.waitForSelector('[data-testid="series-scoreboard"]', { timeout: LONG });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="series-score-a"]')?.textContent) + Number(document.querySelector('[data-testid="series-score-b"]')?.textContent) === 1, null, { timeout: LONG });

    // Map 2: through Match Day round by round; leaving mid-map plays it out.
    await page.getByTestId('series-open-game').click();
    await page.waitForSelector('[data-testid="series-md-banner"]', { timeout: 20000 });
    await page.getByTestId('mode-interactive').click();
    await page.getByTestId('start-interactive').click();
    await page.waitForSelector('[data-testid="session-bar"]', { timeout: LONG });
    // [manager] a series map is played with the manager layer too (through the series host)
    await page.getByTestId('mgr-toggle').click();
    await page.waitForSelector('[data-testid="mgr-panel"]', { timeout: 20000 });
    assert.equal(await page.locator('[data-testid^="mgr-player-"]').count(), 5, 'series map: the drawer lists our five');
    await page.getByTestId('mgr-tempo-slow').click();
    await page.waitForFunction(() => document.querySelector('[data-testid="mgr-tempo-slow"]')?.getAttribute('aria-checked') === 'true', null, { timeout: LONG });
    await page.getByTestId('mgr-toggle').click();
    await page.getByTestId('next-round').click();
    // The live view plays each round in full; a round chip appears once the engine has played it.
    await page.waitForFunction(() => document.querySelectorAll('[data-testid="roundstrip"] [data-testid^="round-chip-"]').length >= 1, null, { timeout: LONG });
    await page.getByTestId('series-return').click();
    await page.waitForSelector('[data-testid="series-scoreboard"]', { timeout: LONG });
    await page.waitForFunction(() => Number(document.querySelector('[data-testid="series-score-a"]')?.textContent) + Number(document.querySelector('[data-testid="series-score-b"]')?.textContent) === 2, null, { timeout: LONG });

    // Map 3 only if the series is level.
    let maps = 2;
    if ((await phase()) === 'playing') {
      await page.getByTestId('series-quick-game').click();
      await page.waitForFunction(() => document.querySelector('[data-testid="series-screen"]')?.getAttribute('data-phase') === 'finished', null, { timeout: LONG });
      maps = 3;
    }
    await page.waitForSelector('[data-testid="series-summary"]', { timeout: 20000 });
    assert.equal(await seriesScore(), maps, 'every map played counts once');
    const summaryTxt = await page.getByTestId('series-screen').innerText();
    if (shots) { await resize(1280, 720); await page.screenshot({ path: path.join(OUT, shots.summary) }); await resize(1280, 800); }
    return { againstAdvice, boardTxt, summaryTxt, maps };
  }

  // ── Korean (default) ──
  // The app opens on the start menu; the series screen is under Quick Match.
  const enterSandbox = async () => {
    await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
    await page.getByTestId('start-quick-match').click();
    await page.waitForSelector('[data-testid="screen-match-day"]', { timeout: 20000 });
  };
  await enterSandbox();
  await page.evaluate(() => localStorage.setItem('pv-lang', 'ko'));
  await page.reload();
  await enterSandbox();
  await resize(1280, 800);
  const ko = await playSeries({ lang: 'ko', shots: { veto: 'desktop-veto.png', summary: 'desktop-series-summary.png' } });
  assert.ok(/밴픽 기록/.test(ko.summaryTxt) && /승리/.test(ko.summaryTxt), 'series summary renders in Korean');
  assert.ok(/디사이더/.test(ko.boardTxt), 'the decider is marked on the series scoreboard');
  assert.ok(ko.summaryTxt.includes(`${ko.againstAdvice} 밴`), 'our off-advice ban is in the veto record');
  assert.ok(!/\{\w+\}/.test(ko.summaryTxt) && !/ser\.[a-z]/.test(ko.summaryTxt), 'no unresolved i18n keys or placeholders');
  console.log(`ko: Bo3 played over ${ko.maps} maps; first ban against advice: ${ko.againstAdvice}`);

  // ── English ──
  await page.getByTestId('series-reset').click();
  await page.getByTestId('nav-about').click();
  await page.getByTestId('lang-en').click();
  const en = await playSeries({ lang: 'en', shots: { veto: 'desktop-veto-en.png', summary: 'desktop-series-summary-en.png' } });
  assert.ok(/veto log/i.test(en.summaryTxt) && /win the series/i.test(en.summaryTxt), 'series summary renders in English'); // group labels are upper-cased by CSS
  assert.ok(!HANGUL.test(en.summaryTxt) && !HANGUL.test(en.boardTxt), 'no Korean left in the English series screens');
  assert.ok(!/\{\w+\}/.test(en.summaryTxt) && !/ser\.[a-z]/.test(en.summaryTxt), 'no unresolved i18n keys or placeholders');
  console.log(`en: Bo3 played over ${en.maps} maps`);
  await page.getByTestId('series-reset').click();
  await page.getByTestId('nav-about').click();
  await page.getByTestId('lang-ko').click();

  await app.close();
  console.log('SERIES E2E OK — screenshots in apps/desktop/docs/');
}
main().catch((e) => { console.error('SERIES E2E FAILED:', e); process.exit(1); });
