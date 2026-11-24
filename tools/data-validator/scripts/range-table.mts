// Duel win probability by weapon pair, armor and distance (combat-engine Monte Carlo) — the range
// curve eco and anti-eco play read (backlog A9 EC-04/DF-06). Report-only; writes a markdown table.
//   npx tsx tools/data-validator/scripts/range-table.mts
import { monteCarloDuel, OPEN_POSTURE, type Combatant } from "../../../packages/combat-engine/src/index.ts";
import { loadWeapons } from "../../../packages/match-runner/src/setup.ts";

const weapons = Object.fromEntries(Object.entries(loadWeapons()).map(([k, v]) => [k.toLowerCase(), v]));
const skills = { aim: 0.6, reaction: 0.6, tracking: 0.6, firstBulletAccuracy: 0.6, crosshairPlacement: 0.6, movement: 0.6, weaponControl: 0.6 };
const mk = (id: string, w: string, armor: number): Combatant => ({ id, teamId: id, health: 100, armor, weapon: weapons[w]!, skills, posture: { ...OPEN_POSTURE, aimOffsetDeg: 5 } });
const pairs: Array<[string, number, string, number]> = [
  ["classic", 0, "spectre", 25], ["classic", 0, "sheriff", 25], ["classic", 0, "vandal", 50], ["classic", 25, "spectre", 25],
  ["sheriff", 0, "spectre", 25], ["sheriff", 25, "vandal", 50], ["spectre", 25, "vandal", 50], ["spectre", 25, "operator", 50],
];
const dists = [3, 6, 10, 15, 20, 30];
console.log(`| own (armor) vs enemy (armor) | ${dists.map((d) => `${d} m`).join(" | ")} |`);
console.log(`|---|${dists.map(() => "---").join("|")}|`);
for (const [a, aa, b, ba] of pairs) {
  if (!weapons[a] || !weapons[b]) { console.log(`| ${a} vs ${b} | missing |`); continue; }
  const row = dists.map((d) => monteCarloDuel({ a: mk("a", a, aa), b: mk("b", b, ba), distanceMeters: d }, 2000, 11).winRateA.toFixed(2));
  console.log(`| ${a} (${aa}) vs ${b} (${ba}) | ${row.join(" | ")} |`);
}
