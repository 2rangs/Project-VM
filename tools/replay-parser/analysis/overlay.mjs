// PROJECT V — PV-6: render a minimap overlay PNG to visually verify the
// world->minimap projection of real decoded positions.
//
//   node overlay.mjs <_points.json> <out.png>
//
// _points.json is written by run-analysis.mjs: { identified, transform,
// minimapImage, points:[[x,y]...], zones:[{callout,x,y}...] }. We draw the
// valorant-api minimap, overlay projected sample points (cyan) and callout
// anchors (orange), and screenshot. Uses the pre-installed Playwright/Chromium.

import fs from 'node:fs';
import { createRequire } from 'node:module';
import { projectPoint } from './mapproj.mjs';

// Playwright is pre-installed globally (not a local dep); resolve it from the
// tools root. Override with PLAYWRIGHT_REQUIRE_BASE if it lives elsewhere.
const requireFrom = createRequire(process.env.PLAYWRIGHT_REQUIRE_BASE || '/opt/node-tools/');
const { chromium } = requireFrom('playwright');

const [, , pointsPath, outPng] = process.argv;
if (!pointsPath || !outPng) {
  console.error('Usage: node overlay.mjs <_points.json> <out.png>');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(pointsPath, 'utf8'));
const SIZE = 900;
const t = data.transform;

const proj = (x, y) => { const p = projectPoint(x, y, t); return [p.mx * SIZE, p.my * SIZE]; };
const samplePts = data.points.map(([x, y]) => proj(x, y));
const zonePts = (data.zones || []).filter((z) => typeof z.x === 'number')
  .map((z) => ({ xy: proj(z.x, z.y), callout: z.callout }));

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;background:#0b0e13}#c{display:block}</style></head><body>
  <canvas id="c" width="${SIZE}" height="${SIZE}"></canvas>
  <script>
    const S=${SIZE}, samples=${JSON.stringify(samplePts)}, zones=${JSON.stringify(zonePts)};
    const ctx=document.getElementById('c').getContext('2d');
    const img=new Image(); img.crossOrigin='anonymous';
    img.onload=()=>{
      ctx.globalAlpha=0.75; ctx.drawImage(img,0,0,S,S); ctx.globalAlpha=1;
      // callout anchors
      ctx.fillStyle='#ff9f40';
      for(const z of zones){ ctx.beginPath(); ctx.arc(z.xy[0],z.xy[1],3,0,7); ctx.fill(); }
      // sample points
      ctx.fillStyle='rgba(60,220,255,0.85)';
      for(const p of samples){ ctx.beginPath(); ctx.arc(p[0],p[1],2,0,7); ctx.fill(); }
      window.__done=true;
    };
    img.onerror=()=>{ window.__done='error'; };
    img.src=${JSON.stringify(data.minimapImage)};
  </script></body></html>`;

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 2 });
await page.setContent(html, { waitUntil: 'load' });
const ok = await page.waitForFunction('window.__done === true', { timeout: 20000 }).then(() => true).catch(() => false);
const status = await page.evaluate('window.__done');
await page.locator('#c').screenshot({ path: outPng });
await browser.close();
console.error(`overlay: ${ok ? 'drawn' : 'TIMEOUT'} (img=${status}) points=${samplePts.length} -> ${outPng}`);
if (status === 'error') process.exitCode = 2;
