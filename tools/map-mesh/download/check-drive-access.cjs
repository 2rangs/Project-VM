#!/usr/bin/env node
/**
 * PROJECT V — PV-5 Map Mesh
 * Check (without downloading) whether each user-provided Drive map file is
 * reachable. Opens the Drive view page and reads the page <title>, which Drive
 * renders as "<filename> - Google Drive" for accessible files. Also records the
 * HTTP status. This is a read-only probe; it downloads no file bytes.
 *
 * Usage: node tools/map-mesh/download/check-drive-access.cjs
 * Prints a JSON array to stdout.
 */
'use strict';
const { chromium } = require('playwright');

// README §10.1 / Handoff §9.1 map list.
const MAPS = [
  ['Abyss',    '1BW2cxkBUz70ed3AYA2nGITvQlvuaEX8t'],
  ['Ascent',   '1n9Z3-kMqzaqETP1lxGvQpfQSBrX5zChB'],
  ['Bind',     '1kAY2m05wdDnU9_3aOgrL_4b-p66AuLnK'],
  ['Breeze',   '1QpiCKTIJgzU735HzNH84Io5eYeoPhDdd'],
  ['Fracture', '1WCTrmYIH9VNpXYGUN4w9U8S_nq_7Cx3I'],
  ['Haven',    '1e1wFXD2iBrYMPFNBwUgDnE9GpPTwt9rJ'],
  ['Icebox',   '1TzjOGVTZ0Du9E9-k3d9Vi7BN7qvX6hV1'],
  ['Lotus',    '1J_FcYU3iRcvZIGRvxvdM8s7sRm5OAPTN'],
  ['Pearl',    '1L9BPmfJnlOOcduu-rlftTkgUP0r0ENh0'],
  ['Split',    '1yTkqrAbinK1PyAFNZoyUfjvd5vA0ZMMd'],
  ['Sunset',   '1O-iEnHY1MfGcDdm32YK3f0kiA0UEybhG'],
];

(async () => {
  const browser = await chromium.launch({
    headless: true,
    proxy: process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined,
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext();
  const out = [];
  for (const [name, id] of MAPS) {
    const page = await ctx.newPage();
    const rec = { map: name, fileId: id, url: `https://drive.google.com/open?id=${id}` };
    try {
      const resp = await page.goto(`https://drive.google.com/file/d/${id}/view`,
        { waitUntil: 'domcontentloaded', timeout: 45000 });
      rec.httpStatus = resp ? resp.status() : null;
      const title = await page.title();
      rec.pageTitle = title;
      // Accessible files render "<filename> - Google Drive"; blocked ones say
      // "Sign in" / "Access Denied" / similar.
      rec.filename = /- Google Drive$/.test(title) ? title.replace(/ - Google Drive$/, '') : null;
      rec.accessible = !!rec.filename && !/sign in|access denied|권한 필요|로그인/i.test(title);
    } catch (e) {
      rec.error = e.message;
      rec.accessible = false;
    }
    await page.close();
    out.push(rec);
    console.error(`[check] ${name}: ${rec.accessible ? 'OK' : 'NO'} — ${rec.pageTitle || rec.error}`);
  }
  await browser.close();
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
