// Plant spot candidates per site (round-simulator plant-spot.ts) — report-only.
//   npx tsx tools/data-validator/scripts/plant-spots.mts [map ...]
import { loadMap, MAP_IDS } from "../../../packages/spatial-engine/src/index.ts";
import { plantSpotsOf } from "../../../packages/round-simulator/src/plant-spot.ts";

const maps = process.argv.slice(2).length ? process.argv.slice(2) : [...MAP_IDS];
for (const m of maps) {
  let eng;
  try { eng = loadMap(m); } catch (e) { console.log(`${m}: ${(e as Error).message}`); continue; }
  const sites = plantSpotsOf(eng);
  console.log(`== ${m} (${sites.size} sites)`);
  for (const s of sites.values()) {
    console.log(`  ${s.site} ${s.zone} retake=[${s.retakeEntries.join(",")}] attack=[${s.attackEntries.join(",")}]`);
    for (const c of s.candidates) {
      const rs = s.retakeEntries.map((r) => `${r}:${c.retakeSight[r]}/${Math.round(c.retakeReachMs[r]! / 100) / 10}s`).join(" ");
      console.log(`    ${c.id.padEnd(40)} exp=${String(c.exposure).padStart(4)} guard=${String(c.guardSight).padStart(3)} ${rs}`);
    }
  }
}
