/**
 * What a gun is worth against the shield it will meet. The team's round-win belief reads loadout
 * values in credits; a credit price says what a gun does against a full buy, not against an eco.
 * Against a target with no or a light shield an SMG kills nearly as fast as a rifle, so the rifle's
 * extra 1300 credits buy little that round. That is why a team that wins the pistol round buys
 * SMGs, heavy shields and utility rather than rifles with light shields.
 *
 * worth(w, a) = price(w) · [TTK(w, heavy) / TTK(w, a)] / [TTK(ref, heavy) / TTK(ref, a)]
 *
 * TTK is the expected time to kill (seconds) from the sim's own damage table
 * (data/weapons.manual-approx.json): shots to kill 100 health behind `a` shield points (shields
 * block first, as combat-engine applies damage), minus one, over the fire rate. Each shot is a head
 * shot with probability HEAD_SHARE (VCT international mean headshot share, 27%) and otherwise a body
 * shot, averaged over an engagement-range mix. ref is the Vandal. Against heavy shields every gun is
 * worth its price, so full-buy rounds, where the belief was fitted, read the same.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface DamageBand { readonly maxRangeMeters: number; readonly head: number; readonly body: number }
interface WeaponRow { readonly id: string; readonly cost: number; readonly fireRate: number; readonly damageBands: readonly DamageBand[] }

const HEALTH = 100;
const HEAVY_PTS = 50;
/** VCT international mean headshot share (player_map.hs_pct_all, 27%). */
const HEAD_SHARE = 0.27;
/**
 * Engagement ranges (metres) and their weights. Provisional: close and mid fights dominate; the sim's
 * minimum pair distance per round has a median of ~28 world units.
 */
const RANGES: readonly (readonly [number, number])[] = [[8, 0.4], [22, 0.4], [40, 0.2]];
const REFERENCE = "vandal";

let table: Map<string, WeaponRow> | null = null;
function weapons(): Map<string, WeaponRow> {
  if (table) return table;
  const here = dirname(fileURLToPath(import.meta.url));
  const raw = JSON.parse(readFileSync(resolve(here, "..", "data", "weapons.manual-approx.json"), "utf8")) as { weapons: WeaponRow[] };
  table = new Map(raw.weapons.map((w) => [w.id, w]));
  return table;
}

function band(w: WeaponRow, range: number): DamageBand {
  return w.damageBands.find((b) => range <= b.maxRangeMeters) ?? w.damageBands[w.damageBands.length - 1]!;
}

/** Expected seconds to kill a target with `armor` shield points (0 for a one-shot weapon). */
export function timeToKill(weaponId: string, armor: number): number | undefined {
  const w = weapons().get(weaponId.toLowerCase());
  if (!w || w.fireRate <= 0) return undefined;
  let t = 0;
  for (const [range, weight] of RANGES) {
    const b = band(w, range);
    const memo = new Map<string, number>();
    const shots = (hp: number, sh: number): number => {
      const key = `${hp}:${sh}`;
      const hit = memo.get(key);
      if (hit !== undefined) return hit;
      let e = 0;
      for (const [dmg, p] of [[b.head, HEAD_SHARE], [b.body, 1 - HEAD_SHARE]] as const) {
        const absorbed = Math.min(sh, dmg);
        const left = hp - (dmg - absorbed);
        e += p * (1 + (left <= 0 ? 0 : shots(left, sh - absorbed)));
      }
      memo.set(key, e);
      return e;
    };
    t += weight * (shots(HEALTH, Math.max(0, armor)) - 1) / w.fireRate;
  }
  return t;
}

const worthCache = new Map<string, number>();

/** A weapon's worth (credits) against a target wearing `armor` shield points; = price at heavy. */
export function armorMatchedPrice(weaponId: string, price: number, armor: number): number {
  if (price <= 0) return price;
  const a = Math.max(0, Math.min(HEAVY_PTS, Math.round(armor)));
  const key = `${weaponId.toLowerCase()}:${a}`;
  const cached = worthCache.get(key);
  if (cached !== undefined) return price * cached;
  const own = [timeToKill(weaponId, HEAVY_PTS), timeToKill(weaponId, a)];
  const ref = [timeToKill(REFERENCE, HEAVY_PTS), timeToKill(REFERENCE, a)];
  let factor = 1;
  if (own[0] && own[1] && ref[0] && ref[1]) factor = (own[0] / own[1]) / (ref[0] / ref[1]);
  worthCache.set(key, factor);
  return price * factor;
}
