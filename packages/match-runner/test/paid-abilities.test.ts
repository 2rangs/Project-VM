/**
 * Abilities on: a player takes into the round only the abilities its buy paid for — the agent's
 * buyable kit with a bought kit; otherwise only what the game gives free every round (the
 * signature's charge) and the ultimate when it has the points. And the defense sets up where it
 * does with abilities off: abilities change what players can do, not where they stand.
 */
import { describe, expect, it } from "vitest";
import { getAbilityEffects } from "@pv/game-data";
import { runMatch, simulatableTeamRefs, type MatchConfig } from "../src/index.js";

const teams = simulatableTeamRefs();
const cfg = (seed: number, over: Partial<MatchConfig> = {}): MatchConfig => ({ teamA: teams[0]!, teamB: teams[1]!, map: "Ascent", seed, maxRounds: 6, enableAbilities: true, ...over });
const SLOT = new Map(["omen", "sova", "kayo", "killjoy", "jett"].flatMap((a) => getAbilityEffects(a).map((e) => [e.abilityId, e.slot] as const)));
/** game-data slot → loadout slot (match-runner abilities.ts): Ultimate → ultimate, Ability2 → signature, the rest basic. */
const loadoutSlot = (abilityId: string) => (SLOT.get(abilityId) === "Ultimate" ? "ultimate" : SLOT.get(abilityId) === "Ability2" ? "signature" : "basic");

describe("abilities come with the buy", () => {
  const m = runMatch(cfg(3));

  it("every basic ability cast was paid for: the caster's buy that round includes its kit", () => {
    let basics = 0;
    for (const r of m.rounds) {
      for (const e of r.events) {
        if (e.kind !== "abilityUsed" || !e.actor || !e.detail || loadoutSlot(e.detail) !== "basic") continue;
        basics++;
        const side = e.actor.startsWith("atk") ? "attack" : "defense";
        const slot = side === "attack" ? r.attacker : r.attacker === "A" ? "B" : "A";
        const i = Number(e.actor.slice(3)) - 1;
        expect(r.buys[slot].players[i]!.utility, `${e.actor} cast ${e.detail} in round ${r.roundNumber}`).toBeGreaterThan(0);
      }
    }
    expect(basics).toBeGreaterThan(0); // the kit is bought on some rounds and then used
  });

  it("counterfactual — same round, two players: the one who skipped the kit casts no basic ability, a kit buyer may", () => {
    let skipped = 0, skippedBasics = 0;
    for (const r of m.rounds) {
      for (const side of ["attack", "defense"] as const) {
        const slot = side === "attack" ? r.attacker : r.attacker === "A" ? "B" : "A";
        r.buys[slot].players.forEach((p, i) => {
          if (p.utility > 0) return;
          skipped++;
          const id = `${side === "attack" ? "atk" : "def"}${i + 1}`;
          skippedBasics += r.events.filter((e) => e.kind === "abilityUsed" && e.actor === id && loadoutSlot(e.detail!) === "basic").length;
        });
      }
    }
    expect(skipped).toBeGreaterThan(0); // players do skip the kit (pistol and eco rounds)
    expect(skippedBasics).toBe(0);
  });

  it("is deterministic", () => {
    expect(runMatch(cfg(3)).rounds.map((r) => r.events)).toEqual(m.rounds.map((r) => r.events));
  });
});
