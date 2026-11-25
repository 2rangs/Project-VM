// Mover vs holder duel by weapon (report-only): how much a moving peeker loses against a still
// holder, per weapon, with and without the catalogue's run-and-gun accuracy (weaponModes), under
// the legacy (gaze-off) stop times. Pistol-round diagnosis (docs/handoff/engine-truth.md).
//   npx tsx tools/data-validator/scripts/mover-duel.mts
import { monteCarloDuel, OPEN_POSTURE, DEFAULT_PARAMS, type Combatant } from "../../../packages/combat-engine/src/index.ts";
import { loadWeapons } from "../../../packages/match-runner/src/setup.ts";

const legacy = { ...DEFAULT_PARAMS, accuracy: { ...DEFAULT_PARAMS.accuracy, stopMs: { run: 700, walk: 350 } } };
const skills = { aim: 0.6, reaction: 0.6, tracking: 0.6, firstBulletAccuracy: 0.6, crosshairPlacement: 0.6, movement: 0.6, weaponControl: 0.6 };
for (const modes of [false, true]) {
  const w = Object.fromEntries(Object.entries(loadWeapons({ modes })).map(([k, v]) => [k.toLowerCase(), v]));
  console.log(`weaponModes=${modes}`);
  for (const [gun, armor] of [["classic", 25], ["vandal", 50], ["spectre", 50]] as const) {
    const mk = (id: string, moving: boolean): Combatant => ({ id, teamId: id, health: 100, armor, weapon: w[gun]!, skills, posture: { ...OPEN_POSTURE, moving, seesEnemyAtMs: 0 } });
    const row = [8, 12, 17, 25].map((d) => {
      const mv = monteCarloDuel({ a: mk("a", true), b: mk("b", false), distanceMeters: d }, 3000, 7, { params: legacy }).winRateA;
      const st = monteCarloDuel({ a: mk("a", false), b: mk("b", false), distanceMeters: d }, 3000, 7, { params: legacy }).winRateA;
      return `${d}m mover ${mv.toFixed(2)} (still ${st.toFixed(2)})`;
    });
    console.log(`  ${gun.padEnd(8)} ${row.join(" | ")}`);
  }
}
