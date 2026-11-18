import type { AbilitySpec } from "./types.js";

export type AbilityCatalog = Record<string, AbilitySpec>;

export function buildAbilityCatalog(specs: readonly AbilitySpec[]): AbilityCatalog {
  const out: AbilityCatalog = {};
  for (const s of specs) out[s.abilityId] = s;
  return out;
}

export function requireAbility(catalog: AbilityCatalog, abilityId: string): AbilitySpec {
  const s = catalog[abilityId];
  if (!s) throw new Error(`ability not in catalog: ${abilityId}`);
  return s;
}
