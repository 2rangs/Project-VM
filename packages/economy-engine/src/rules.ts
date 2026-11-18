/**
 * Economy & ultimate rule constants.
 *
 * Numeric economy rules MIRROR PV-core `@pv/game-rules` (packages/game-rules on origin/claude/pv-core)
 * — prices, armor, loss-bonus ladder, rewards, ultimate-point rules — which are all provisional
 * (verified:false, pending a patch-source pass). Do not treat them as confirmed (README §29).
 *
 * Ultimate POINT REQUIREMENTS instead come from the PV-1 research catalog
 * (origin/claude/pv-research: tools/catalog-builder/data/ability_facts.json, field `ultPoints`),
 * which is the official current value (wiki Abilities tables, build release-13.10, gameplayVerified).
 * These override PV-core's small sample where they differ (jett, sage, killjoy, brimstone).
 */
import type { ArmorType } from "./shared-mirror.js";

export interface Rule<T> {
  readonly value: T;
  readonly verified: boolean;
  readonly source: string;
  readonly note?: string;
}
const rv = <T>(value: T, verified: boolean, source: string, note?: string): Rule<T> =>
  note === undefined ? { value, verified, source } : { value, verified, source, note };

const WIKI_CREDITS = "https://wiki.playvalorant.com/en-us/Credits";
const PATCH_1_11 =
  "https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-11/";
const CATALOG = "pv-research:tools/catalog-builder/data/ability_facts.json (build release-13.10)";

// --- credits / rewards (mirror of @pv/game-rules, provisional) -------------------------------
export const ECONOMY = {
  startingCredits: rv(800, false, WIKI_CREDITS, "Pistol-round start."),
  maxCredits: rv(9000, false, WIKI_CREDITS),
  roundWinReward: rv(3000, false, WIKI_CREDITS),
  lossBonusLadder: rv([1900, 2400, 2900], false, PATCH_1_11, "1st/2nd/3rd+ consecutive loss."),
  spikePlantReward: rv(300, false, WIKI_CREDITS, "Team award for planting, even on a lost round."),
  killReward: rv(200, false, WIKI_CREDITS, "Default weapon kill."),
} as const;

export const ARMOR: Record<Exclude<ArmorType, "none">, { cost: Rule<number>; points: Rule<number> }> = {
  light: { cost: rv(400, false, WIKI_CREDITS), points: rv(25, false, WIKI_CREDITS) },
  heavy: { cost: rv(1000, false, WIKI_CREDITS), points: rv(50, false, WIKI_CREDITS) },
  regen: { cost: rv(650, false, WIKI_CREDITS, "Patch-dependent."), points: rv(25, false, WIKI_CREDITS) },
};

// --- weapon prices (mirror of @pv/game-rules weapons.ts, provisional) ------------------------
export type WeaponClass = "sidearm" | "smg" | "shotgun" | "rifle" | "sniper" | "machinegun";
export interface WeaponPrice {
  readonly key: string;
  readonly displayName: string;
  readonly cls: WeaponClass;
  readonly price: number;
}
export const WEAPON_PRICES: readonly WeaponPrice[] = [
  { key: "classic", displayName: "Classic", cls: "sidearm", price: 0 },
  { key: "shorty", displayName: "Shorty", cls: "sidearm", price: 150 },
  { key: "frenzy", displayName: "Frenzy", cls: "sidearm", price: 450 },
  { key: "ghost", displayName: "Ghost", cls: "sidearm", price: 500 },
  { key: "sheriff", displayName: "Sheriff", cls: "sidearm", price: 800 },
  { key: "stinger", displayName: "Stinger", cls: "smg", price: 1100 },
  { key: "spectre", displayName: "Spectre", cls: "smg", price: 1600 },
  { key: "bucky", displayName: "Bucky", cls: "shotgun", price: 850 },
  { key: "judge", displayName: "Judge", cls: "shotgun", price: 1850 },
  { key: "bulldog", displayName: "Bulldog", cls: "rifle", price: 2050 },
  { key: "guardian", displayName: "Guardian", cls: "rifle", price: 2250 },
  { key: "phantom", displayName: "Phantom", cls: "rifle", price: 2900 },
  { key: "vandal", displayName: "Vandal", cls: "rifle", price: 2900 },
  { key: "marshal", displayName: "Marshal", cls: "sniper", price: 950 },
  { key: "outlaw", displayName: "Outlaw", cls: "sniper", price: 2400 },
  { key: "operator", displayName: "Operator", cls: "sniper", price: 4700 },
  { key: "ares", displayName: "Ares", cls: "machinegun", price: 1600 },
  { key: "odin", displayName: "Odin", cls: "machinegun", price: 3200 },
];
const PRICE_BY_KEY = new Map(WEAPON_PRICES.map((w) => [w.key, w]));
export const weaponPrice = (key: string): number | undefined => PRICE_BY_KEY.get(key)?.price;
export const weaponInfo = (key: string): WeaponPrice | undefined => PRICE_BY_KEY.get(key);

// --- ultimate point earning (mirror of @pv/game-rules, provisional) --------------------------
export const ULT_POINT_RULES = {
  pointForKill: rv(1, false, CATALOG),
  pointForDeath: rv(1, false, CATALOG, "Victim earning a point has varied by patch — verify."),
  pointForSpikePlant: rv(1, false, CATALOG),
  pointForSpikeDefuse: rv(1, false, CATALOG),
  pointForOrb: rv(1, false, CATALOG),
  orbsPerMap: rv(2, false, CATALOG),
  // README §21.4: spike/fall deaths may not charge the enemy's ult like a normal kill does.
  nonHostileDeathGrantsEnemyPoint: rv(false, false, CATALOG, "UNVERIFIED per patch."),
} as const;

// --- ultimate point REQUIREMENTS (CANONICAL, from PV-1 catalog, gameplayVerified) ------------
export const ULT_POINTS: Readonly<Record<string, number>> = {
  astra: 7, breach: 8, brimstone: 8, chamber: 8, clove: 8, cypher: 7, deadlock: 7, fade: 8,
  gekko: 8, harbor: 7, hush: 8, iso: 7, jett: 8, "kay-o": 8, killjoy: 9, miks: 8, neon: 8,
  omen: 7, phoenix: 7, raze: 8, reyna: 7, sage: 7, skye: 8, sova: 8, tejo: 9, veto: 7,
  viper: 9, vyse: 8, waylay: 8, yoru: 8,
};
export const ULT_POINTS_SOURCE = { source: CATALOG, verified: true };

/** Points required for an agent's ultimate (canonical catalog), or undefined if unknown. */
export const ultPointsRequired = (agentKey: string): number | undefined =>
  ULT_POINTS[(agentKey || "").toLowerCase()];

// --- small pure helpers (mirror of @pv/game-rules) -------------------------------------------
export function lossBonusFor(consecutiveLosses: number): number {
  const ladder = ECONOMY.lossBonusLadder.value;
  if (consecutiveLosses <= 0) return 0;
  const idx = Math.min(consecutiveLosses, ladder.length) - 1;
  return ladder[idx]!;
}
export const armorCost = (type: ArmorType): number => (type === "none" ? 0 : ARMOR[type].cost.value);
export function clampCredits(credits: number): number {
  const max = ECONOMY.maxCredits.value;
  return credits < 0 ? 0 : credits > max ? max : credits;
}
