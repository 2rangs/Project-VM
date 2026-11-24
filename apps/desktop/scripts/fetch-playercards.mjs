// Fetch a pool of player cards (wide + large art) from Kingdom Archives into
// apps/desktop/assets/playercards/ (gitignored; never shipped). The match load screen gives every
// player one of them (stable per player) like the in-game loading screen does.
//   node scripts/fetch-playercards.mjs [pages=14] [perPage=5]
import { mkdir, writeFile, access } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'playercards');
const PAGES = Number(process.argv[2] ?? 14), PER = Number(process.argv[3] ?? 5);
const BASE = 'https://kingdomarchives.com';
const UA = { 'User-Agent': 'ProjectV-fetch/1.0 (personal, non-commercial)' };
const exists = (p) => access(p).then(() => true, () => false);
await mkdir(root, { recursive: true });
const cards = [];
for (let page = 1; page <= PAGES; page++) {
  const html = await (await fetch(`${BASE}/playercards?page=${page}`, { headers: UA })).text();
  const larges = [...new Set([...html.matchAll(/uploads\/playercards\/([^"]*?)_large\.png/g)].map((m) => m[1]))];
  // spread over the page so the pool is varied
  const step = Math.max(1, Math.floor(larges.length / PER));
  for (let i = 0; i < larges.length && cards.length < PAGES * PER; i += step) {
    const stem = larges[i];
    const id = `c${String(cards.length).padStart(3, '0')}`;
    let ok = true;
    for (const kind of ['wide', 'large']) {
      const dest = path.join(root, `${id}_${kind}.png`);
      if (await exists(dest)) continue;
      const r = await fetch(`${BASE}/uploads/playercards/${stem}_${kind}.png`, { headers: UA });
      if (!r.ok) { ok = false; break; }
      await writeFile(dest, Buffer.from(await r.arrayBuffer()));
    }
    if (ok) cards.push({ id, name: stem.split('/').pop().replace(/Card$/, '') });
    if (cards.length % 5 === 0) process.stdout.write('.');
  }
}
await writeFile(path.join(root, 'manifest.json'), JSON.stringify(cards));
console.log('\ndone', cards.length, '→', root);
