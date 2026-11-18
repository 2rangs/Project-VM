/**
 * Ability wiring from @pv/game-data (PV-1) into the round-simulator's AbilityCatalog + per-player
 * loadouts (Stage 2 of the runMatchRound migration).
 *
 * game-data's `getAbilityEffects(agent)` returns records whose `slot` (Ability1/Ability2/Grenade/
 * Ultimate), `effectTypes` and `params` match the ability-engine's CatalogEffectRecord field for
 * field, so `abilitySpecFromCatalog` converts each directly. Both teams run a fixed, standard
 * Ascent composition (a richer per-roster comp selection is a later pass). Abilities give the
 * policy real utility (smokes/flashes/recon) to deploy on execute and retake.
 */
import { getAbilityEffects } from "@pv/game-data";
import {
  abilitySpecFromCatalog,
  buildAbilityCatalog,
  type AbilityCatalog,
} from "@pv/ability-engine";
import type { RoundAbilityLoadout, LoadoutAbilitySlot } from "@pv/round-simulator";

/** A standard Ascent comp (controller/initiator×2/sentinel/duelist); all exist in game-data. */
export const ASCENT_COMP: readonly string[] = ["omen", "sova", "kayo", "killjoy", "jett"];

type RawEffect = { abilityId: string; slot: string; charges?: number };

/** game-data slot (Ability1/Ability2/Grenade/Ultimate) → loadout slot (basic/signature/ultimate). */
function loadoutSlot(slot: string): LoadoutAbilitySlot {
  if (slot === "Ultimate") return "ultimate";
  if (slot === "Ability2") return "signature"; // the recharging signature ability (heuristic)
  return "basic"; // Ability1 / Grenade
}

/** Default starting charges per slot (provisional; a basic/signature has 1–2, ult tracked by points). */
function defaultCharges(slot: LoadoutAbilitySlot): number {
  return slot === "ultimate" ? 0 : 1;
}

/** Build one AbilityCatalog spanning every agent in the comp (keyed by abilityId). */
export function loadAbilityCatalog(comp: readonly string[] = ASCENT_COMP): AbilityCatalog {
  const specs = comp.flatMap((agent) =>
    getAbilityEffects(agent).map((e) => abilitySpecFromCatalog(e as never)),
  );
  return buildAbilityCatalog(specs);
}

/** Per-player ability loadout for an agent: one entry per ability, slotted and charged. */
export function agentAbilityLoadout(agent: string): RoundAbilityLoadout[] {
  return getAbilityEffects(agent).map((e): RoundAbilityLoadout => {
    const raw = e as unknown as RawEffect;
    const slot = loadoutSlot(raw.slot);
    return { abilityId: raw.abilityId, slot, charges: defaultCharges(slot) };
  });
}
