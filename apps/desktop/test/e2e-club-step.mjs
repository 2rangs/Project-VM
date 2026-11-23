// E2E steps for club operations inside a career (used by e2e.electron, e2e.club and e2e.career):
//   startCareer   start menu → new career (profile, first team of a region, slot 1) → Home
//   clubStep      make room in the squad (release), sign a free agent from Transfers (generous wage,
//                 optional contract length), see the player in the Finance wage list, set a training
//                 focus (and optionally a practice map). Screenshots of the three club screens.
import path from 'node:path';
import assert from 'node:assert/strict';

/** From the start menu to Home of a new career. Returns { teamId, teamName }. */
export async function startCareer(page, { name = 'E2E 감독', region = 'pacific' } = {}) {
  await page.waitForSelector('[data-testid="start-menu"]', { timeout: 20000 });
  await page.getByTestId('start-new-career').click();
  await page.getByTestId('nc-name').fill(name);
  await page.getByTestId('nc-next').click();
  await page.waitForSelector('[data-testid="nc-teams"]', { timeout: 30000 });
  await page.getByTestId(`nc-region-${region}`).click();
  const first = page.locator('[data-testid^="nc-team-"]').first();
  const teamId = (await first.getAttribute('data-testid')).replace('nc-team-', '');
  await first.click();
  await page.waitForSelector('[data-testid="team-overview"]');
  await page.getByTestId('nc-next').click();
  await page.getByTestId('nc-start').click();
  await page.waitForSelector('[data-testid="home"]', { timeout: 60000 });
  return { teamId, teamName: await page.getByTestId('ctx-team').innerText() };
}

/** Answer every waiting inbox question (board: the first option; bids for our players: reject). */
export async function answerInbox(page) {
  await page.getByTestId('nav-inbox').click();
  for (let i = 0; i < 10; i++) {
    const waiting = page.locator('.inbox-row:has(.soon-tag)');
    if (await waiting.count() === 0) break;
    await waiting.first().click();
    const reject = page.getByTestId('inbox-option-reject');
    if (await reject.count()) await reject.click();
    else await page.locator('[data-testid^="inbox-option-"]').first().click();
  }
  await page.getByTestId('nav-home').click();
}

export async function clubStep(page, OUT, { years = null, practiceMap = false } = {}) {
  // Make room if the squad is full: release the last player from their contract panel.
  await page.getByTestId('nav-training').click();
  await page.waitForSelector('[data-testid="training-screen"] [data-testid="dt-row"]', { timeout: 10000 });
  const before = await page.locator('[data-testid="training-screen"] [data-testid="dt-row"]').count();
  const releasedCell = page.locator('[data-testid="training-screen"] [data-testid="dt-row"]').last().locator('td').first();
  const released = (await releasedCell.innerText()).trim();
  await releasedCell.click();
  await page.waitForSelector('[data-testid="release-player"]', { timeout: 5000 });
  await page.getByTestId('release-player').click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="training-screen"] [data-testid="dt-row"]').length === n - 1, before, { timeout: 5000 });

  await page.getByTestId('nav-transfers').click();
  await page.waitForSelector('[data-testid="transfers-screen"]', { timeout: 10000 });
  assert.equal(await page.getByTestId('window-status').getAttribute('data-open'), '1', 'the transfer window is open at the start of a career');
  await page.getByTestId('flt-free').check();
  await page.waitForSelector('[data-testid="dt-row"]', { timeout: 10000 });
  // The first free agent we did not just release (a released player cannot be re-signed this season).
  const rows = page.getByTestId('dt-row');
  let row = rows.first();
  for (let i = 0; i < await rows.count(); i++) {
    const h = (await rows.nth(i).locator('td').first().innerText()).replace('★', '').trim();
    if (h !== released) { row = rows.nth(i); break; }
  }
  const handle = (await row.locator('td').first().innerText()).replace('★', '').trim();
  await row.click();
  await page.waitForSelector('[data-testid="offer-form"]', { timeout: 5000 });
  // A generous wage so the player's utility is positive (U = ln(wage/ref) + …).
  const wage = Number(await page.getByTestId('offer-wage').inputValue());
  await page.getByTestId('offer-wage').fill(String(Math.max(300000, wage * 3)));
  if (years) await page.getByTestId('offer-years').fill(String(years));
  await page.screenshot({ path: path.join(OUT, 'desktop-transfers.png') });
  await page.getByTestId('offer-submit').click();
  await page.waitForSelector('[data-testid="offer-status"], [data-testid="offer-error"]', { timeout: 5000 });
  const formText = await page.getByTestId('offer-form').innerText();
  assert.equal(await page.locator('[data-testid="offer-status"][data-status="completed"]').count(), 1, `offer completed — form says: ${formText}`);

  // The player is on our books: the Finance wage list shows them.
  await page.getByTestId('nav-finance').click();
  await page.waitForSelector('[data-testid="finance-screen"]', { timeout: 10000 });
  await page.getByTestId('fin-tab-wages').click();
  await page.waitForSelector('[data-testid="dt-row"]', { timeout: 5000 });
  const wages = await page.locator('[data-testid="finance-screen"] .dt').innerText();
  assert.ok(wages.includes(handle), `${handle} is in the wage list after signing`);
  await page.getByTestId('fin-tab-ledger').click();
  await page.screenshot({ path: path.join(OUT, 'desktop-finance.png') });

  // Training: a team focus is set and shown (tactics + a practice map when asked).
  await page.getByTestId('nav-training').click();
  await page.waitForSelector('[data-testid="training-screen"]', { timeout: 10000 });
  const focus = practiceMap ? 'tactics' : 'mechanics';
  await page.getByTestId(`team-focus-${focus}`).click();
  assert.ok((await page.getByTestId(`team-focus-${focus}`).getAttribute('class'))?.includes('on'), `${focus} focus selected`);
  if (practiceMap) await page.selectOption('[data-testid="practice-map"]', { index: 1 });
  await page.screenshot({ path: path.join(OUT, 'desktop-training.png') });
  return handle;
}
