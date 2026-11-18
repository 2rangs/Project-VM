#!/usr/bin/env node
/**
 * PROJECT V — PV-5 Map Mesh
 * Download a user-provided Blender map from Google Drive using the normal
 * "open the page and press the download button" flow, driven by Playwright/Chromium.
 *
 * This does NOT bypass any Drive protection. It performs exactly what a human
 * does in a browser:
 *   1. open the file's Drive page,
 *   2. press the Download button,
 *   3. if Drive shows the "Google can't scan this file for viruses" warning,
 *      press "Download anyway" (the normal large-file download button).
 *
 * If the interactive flow fails, it falls back to Drive's documented
 * confirm-token flow (uc?export=download -> extract confirm/uuid -> re-request
 * drive.usercontent.google.com/download), which is the same request the
 * "Download anyway" button issues.
 *
 * The raw .blend is NOT committed (user-provided material, license/size
 * unverified). It is written under datasets/spatial/ascent/mesh/raw/ which is
 * .gitignored. Size + SHA256 are printed and written to a sidecar JSON.
 *
 * Usage:
 *   node tools/map-mesh/download/download-drive-map.cjs <fileId> <outDir> [label]
 *
 * Env: uses HTTPS_PROXY for Chromium so it works behind the session proxy.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { chromium } = require('playwright');

function sha256(file) {
  const h = crypto.createHash('sha256');
  h.update(fs.readFileSync(file));
  return h.digest('hex');
}

function log(...a) { console.log('[download]', ...a); }

async function clickByText(page, texts) {
  for (const t of texts) {
    // Match buttons / aria-labels / link text, case-insensitive.
    const byRole = page.getByRole('button', { name: new RegExp(t, 'i') });
    if (await byRole.count().catch(() => 0)) {
      try { await byRole.first().click({ timeout: 4000 }); return `button:${t}`; } catch (_) {}
    }
    const byLabel = page.locator(`[aria-label*="${t}" i]`);
    if (await byLabel.count().catch(() => 0)) {
      try { await byLabel.first().click({ timeout: 4000 }); return `aria:${t}`; } catch (_) {}
    }
    const byLink = page.getByText(new RegExp(`^\\s*${t}\\s*$`, 'i'));
    if (await byLink.count().catch(() => 0)) {
      try { await byLink.first().click({ timeout: 4000 }); return `text:${t}`; } catch (_) {}
    }
  }
  return null;
}

async function interactiveDownload(fileId, outDir, label) {
  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    const viewUrl = `https://drive.google.com/file/d/${fileId}/view`;
    const resp = await page.goto(viewUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    log('view page status', resp && resp.status(), '-', await page.title());

    // Primary download button labels across Drive UI/locales.
    const downloadLabels = ['Download', '다운로드', 'Download anyway', '무시하고 다운로드'];

    const downloadPromise = page.waitForEvent('download', { timeout: 90000 });

    let clicked = await clickByText(page, downloadLabels);
    log('initial download control:', clicked || 'none found, waiting for interstitial');

    // Drive may navigate to the virus-scan warning page after the first click.
    // Give it a moment, then click "Download anyway" if present.
    await page.waitForTimeout(2500);
    const anyway = await clickByText(page, ['Download anyway', '무시하고 다운로드', 'Download']);
    if (anyway) log('interstitial control:', anyway);

    const download = await downloadPromise;
    const suggested = download.suggestedFilename() || `${label}.blend`;
    const outPath = path.join(outDir, suggested);
    await download.saveAs(outPath);
    log('saved', outPath);
    await browser.close();
    return { outPath, method: 'playwright-button' };
  } catch (e) {
    await browser.close();
    throw e;
  }
}

/** Fallback: Drive confirm-token flow using the browser's own network stack. */
async function confirmTokenDownload(fileId, outDir, label) {
  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  try {
    const ucUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;
    await page.goto(ucUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const html = await page.content();

    // The interstitial is a <form> whose action is the real download endpoint,
    // with hidden fields id/export/confirm/uuid. Pressing its submit button is
    // exactly the "Download anyway" action.
    const hasForm = await page.locator('form#download-form, form[action*="usercontent"]').count().catch(() => 0);
    if (hasForm) {
      const downloadPromise = page.waitForEvent('download', { timeout: 90000 });
      await page.locator('form#download-form button, form[action*="usercontent"] [type=submit], #uc-download-link').first().click({ timeout: 8000 });
      const download = await downloadPromise;
      const suggested = download.suggestedFilename() || `${label}.blend`;
      const outPath = path.join(outDir, suggested);
      await download.saveAs(outPath);
      await browser.close();
      return { outPath, method: 'confirm-token-form' };
    }
    await browser.close();
    throw new Error('no confirm-token form found on interstitial');
  } catch (e) {
    await browser.close();
    throw e;
  }
}

async function main() {
  const [fileId, outDir, label = 'map'] = process.argv.slice(2);
  if (!fileId || !outDir) {
    console.error('usage: node download-drive-map.cjs <fileId> <outDir> [label]');
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });

  let result;
  try {
    result = await interactiveDownload(fileId, outDir, label);
  } catch (e) {
    log('interactive flow failed:', e.message);
    log('falling back to confirm-token flow');
    result = await confirmTokenDownload(fileId, outDir, label);
  }

  const st = fs.statSync(result.outPath);
  const hash = sha256(result.outPath);
  const meta = {
    label,
    fileId,
    savedAs: path.basename(result.outPath),
    bytes: st.size,
    sha256: hash,
    method: result.method,
    downloadedAt: new Date().toISOString(),
    sourceUrl: `https://drive.google.com/open?id=${fileId}`,
  };
  const metaPath = result.outPath + '.meta.json';
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2));
  log('bytes', st.size, 'sha256', hash);
  log('meta', metaPath);
  console.log(JSON.stringify(meta));
}

main().catch((e) => { console.error('[download] FATAL', e); process.exit(1); });
