// E2E step for club operations (used by e2e.electron.test.mjs and e2e.club.test.mjs): with a fresh
// world (pre-season window open), make an offer to a free agent from the Transfers screen, see it
// accepted and the player in the Finance wage list; set a training focus. Screenshots of the three
// club screens.
import path from 'node:path';
import assert from 'node:assert/strict';

export async function clubStep(page, OUT) {
  // Fresh world: the career opens on the first days of the pre-season window.
  await page.getByTestId('nav-scouting').click();
  await page.waitForSelector('[data-testid="career-screen"]', { timeout: 10000 });
  await page.getByTestId('career-reset').click();

  // Make room if the squad is full: release the last player from his contract panel.
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
  assert.equal(await page.getByTestId('window-status').getAttribute('data-open'), '1', 'the transfer window is open at the start');
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
  await page.screenshot({ path: path.join(OUT, 'desktop-transfers.png') });
  await page.getByTestId('offer-submit').click();
  await page.waitForSelector('[data-testid="offer-status"], [data-testid="offer-error"]', { timeout: 5000 });
  const formText = await page.getByTestId('offer-form').innerText();
  assert.equal(await page.locator('[data-testid="offer-status"][data-status="completed"]').count(), 1, `offer completed — form says: ${formText}`);

  // The player is on our books: the Finance wage list shows him.
  await page.getByTestId('nav-finance').click();
  await page.waitForSelector('[data-testid="finance-screen"]', { timeout: 10000 });
  await page.getByTestId('club-advance-month').click();
  await page.getByTestId('fin-tab-wages').click();
  await page.waitForSelector('[data-testid="dt-row"]', { timeout: 5000 });
  const wages = await page.locator('[data-testid="finance-screen"] .dt').innerText();
  assert.ok(wages.includes(handle), `${handle} is in the wage list after signing`);
  await page.getByTestId('fin-tab-ledger').click();
  await page.screenshot({ path: path.join(OUT, 'desktop-finance.png') });

  // Training: a team focus is set and shown.
  await page.getByTestId('nav-training').click();
  await page.waitForSelector('[data-testid="training-screen"]', { timeout: 10000 });
  await page.getByTestId('team-focus-mechanics').click();
  assert.ok((await page.getByTestId('team-focus-mechanics').getAttribute('class'))?.includes('on'), 'mechanics focus selected');
  await page.screenshot({ path: path.join(OUT, 'desktop-training.png') });

  // Leave a fresh world behind.
  await page.getByTestId('nav-scouting').click();
  await page.getByTestId('career-reset').click();
  return handle;
}
