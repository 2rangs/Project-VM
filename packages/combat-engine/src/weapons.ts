import type { WeaponSpec } from "./types.js";

/** A weapon catalog keyed by weapon name. */
export type WeaponCatalog = Record<string, WeaponSpec>;

export function buildCatalog(weapons: readonly WeaponSpec[]): WeaponCatalog {
  const out: WeaponCatalog = {};
  for (const w of weapons) out[w.name] = w;
  return out;
}

export function requireWeapon(catalog: WeaponCatalog, name: string): WeaponSpec {
  const w = catalog[name];
  if (!w) throw new Error(`weapon not in catalog: ${name}`);
  return w;
}
