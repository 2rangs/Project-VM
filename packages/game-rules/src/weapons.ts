/**
 * Weapon price / class reference (README §11, §19.3).
 *
 * Provisional prices (verified: false). Canonical weapon *definitions* (damage curves,
 * fire rate, UUIDs) should come from the Data agent via valorant-api.com
 * (https://valorant-api.com/v1/weapons) and datasets/schema/. This table is only the
 * economy-facing price/class so the buy logic has something to reason about now.
 */
import { provisional, type RuleValue } from "./rule-value.js";

const WIKI_CREDITS = "https://wiki.playvalorant.com/en-us/Credits";

export type WeaponClass =
  | "sidearm"
  | "smg"
  | "shotgun"
  | "rifle"
  | "sniper"
  | "machinegun";

export interface WeaponPrice {
  readonly key: string; // lowercase slug; map to valorant-api UUIDs in datasets/schema
  readonly displayName: string;
  readonly class: WeaponClass;
  readonly price: RuleValue<number>;
}

const p = (value: number): RuleValue<number> =>
  provisional(value, WIKI_CREDITS, { unit: "credits", patch: "estimate:>=1.0" });

export const WEAPON_PRICES: readonly WeaponPrice[] = [
  { key: "classic", displayName: "Classic", class: "sidearm", price: p(0) },
  { key: "shorty", displayName: "Shorty", class: "sidearm", price: p(150) },
  { key: "frenzy", displayName: "Frenzy", class: "sidearm", price: p(450) },
  { key: "ghost", displayName: "Ghost", class: "sidearm", price: p(500) },
  { key: "sheriff", displayName: "Sheriff", class: "sidearm", price: p(800) },
  { key: "stinger", displayName: "Stinger", class: "smg", price: p(1100) },
  { key: "spectre", displayName: "Spectre", class: "smg", price: p(1600) },
  { key: "bucky", displayName: "Bucky", class: "shotgun", price: p(850) },
  { key: "judge", displayName: "Judge", class: "shotgun", price: p(1850) },
  { key: "bulldog", displayName: "Bulldog", class: "rifle", price: p(2050) },
  { key: "guardian", displayName: "Guardian", class: "rifle", price: p(2250) },
  { key: "phantom", displayName: "Phantom", class: "rifle", price: p(2900) },
  { key: "vandal", displayName: "Vandal", class: "rifle", price: p(2900) },
  { key: "marshal", displayName: "Marshal", class: "sniper", price: p(950) },
  { key: "outlaw", displayName: "Outlaw", class: "sniper", price: p(2400) },
  { key: "operator", displayName: "Operator", class: "sniper", price: p(4700) },
  { key: "ares", displayName: "Ares", class: "machinegun", price: p(1600) },
  { key: "odin", displayName: "Odin", class: "machinegun", price: p(3200) },
];

const PRICE_BY_KEY = new Map(WEAPON_PRICES.map((w) => [w.key, w]));

export function weaponPrice(key: string): WeaponPrice | undefined {
  return PRICE_BY_KEY.get(key);
}
