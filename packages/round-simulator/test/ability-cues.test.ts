import { describe, it, expect } from "vitest";
import { RoundSimulator, type AbilityCue, type PolicyView } from "../src/index.js";
import { abilityCastCueConfidence, DEPLOYED_EFFECT_CUE_CONFIDENCE } from "../src/situational.js";
import { catalog, charges, player, scene, scripted, spatial, weapons, SMOKE } from "./fixtures/ability-scenes.js";

/**
 * Ability events are observable. One cast, one condition changed at a time:
 *
 *   An attacker throws a smoke onto A main on the first decision. A lone defender stands in
 *   `defenderZone`. What the defender's team can observe of that cast depends only on physical
 *   facts: a sightline onto the smoke (SIGHT cue, at the smoke's zone) and a sound path to the
 *   caster (SOUND cue, at the caster's zone).
 *
 *   A site          sees A main, and is linked to it by sound (attenuation 0.2).
 *   A garden        has no sightline onto A main (sound still reaches it, through the site).
 *   defender spawn  has neither a sightline onto A main nor a sound path to it.
 */
function run(casterZone: string, defenderZone: string, seed = 4) {
  const views: PolicyView[] = [];
  const attack = scripted((p) => (charges(p, SMOKE) > 0 ? { kind: "useAbility", abilityId: SMOKE, targetZone: "a-main" } : undefined), views);
  const defense = scripted(() => ({ kind: "hold", aimZone: "a-main" }), views);
  const state = scene([player("atk", "attack", casterZone, [SMOKE]), player("def", "defense", defenderZone)], 3000, "atk");
  const result = new RoundSimulator({
    spatial, weapons, abilities: catalog, policies: { attack, defense },
    config: { seed, roundTimeMs: 3000, traceCommands: true },
  }).runRound(state);
  const cues = (result.abilityCueTrace ?? []).filter((c) => c.observerSide === "defense");
  const defenseViews = views.filter((v) => v.side === "defense");
  const heard = defenseViews.flatMap((v) => v.observation.audibleEvents.filter((s) => s.kind === "abilityCast"));
  const mapChanges = defenseViews.flatMap((v) => v.observation.knownMapChanges);
  return { result, cues, heard, mapChanges, views };
}
const by = (cues: readonly AbilityCue[], channel: AbilityCue["channel"]) => cues.filter((c) => c.channel === channel);
const centre = (zone: string) => { const z = spatial.getZone(zone)!.position; return { x: z.x, y: z.y, z: z.z }; };

describe("ability cues: a cast leaves evidence for whoever can physically observe it", () => {
  it("counterfactual — sightline: the deployed smoke is seen from A site, not from A garden", () => {
    const seen = run("a-lobby", "a-site");
    const unseen = run("a-lobby", "a-garden");
    expect(by(seen.cues, "sight")).toHaveLength(1);
    expect(by(seen.cues, "sight")[0]!.confidence).toBe(DEPLOYED_EFFECT_CUE_CONFIDENCE);
    expect(by(unseen.cues, "sight")).toHaveLength(0);
    // It reaches the defending team's observation (the policy's input), not just a log …
    expect(seen.heard.some((s) => s.confidence === DEPLOYED_EFFECT_CUE_CONFIDENCE)).toBe(true);
    expect(seen.mapChanges.some((m) => m.note === "smoke:enemy:a-main")).toBe(true);
    // … and with no sightline the team knows nothing of it.
    expect(unseen.heard).toHaveLength(0);
    expect(unseen.mapChanges).toHaveLength(0);
  });

  it("a seen effect is evidence about the EFFECT's zone — never where the caster stands", () => {
    const { cues, mapChanges } = run("a-lobby", "a-site");
    const sight = by(cues, "sight")[0]!;
    expect(sight.zoneId).toBe("a-main"); // the smoke; the caster is in A lobby, unseen and unheard
    expect(sight.zonePosition).toEqual(centre("a-main"));
    // the map change places the smoke where it landed: on A main's floor, the side facing the thrower
    const at = mapChanges.find((m) => m.note === "smoke:enemy:a-main")!.approxPosition;
    expect(spatial.nav!.zoneAt(at)).toBe("a-main");
    expect(by(cues, "sound")).toHaveLength(0); // no sound path from A lobby to A site
  });

  it("counterfactual — sound path: the cast is heard from A main at A site, not in the defender spawn", () => {
    const heard = run("a-main", "a-site");
    const silent = run("a-main", "defender-spawn");
    const sound = by(heard.cues, "sound");
    expect(sound).toHaveLength(1);
    expect(sound[0]!.zoneId).toBe("a-main"); // the caster's zone (zone-level)
    expect(sound[0]!.zonePosition).toEqual(centre("a-main"));
    // A main → A site attenuates by 0.2: confidence = 0.6 × 0.8 × 0.7 (cast loudness).
    expect(sound[0]!.confidence).toBeCloseTo(abilityCastCueConfidence(0.8), 6);
    expect(sound[0]!.confidence).toBeLessThan(DEPLOYED_EFFECT_CUE_CONFIDENCE);
    expect(silent.cues).toHaveLength(0);
    expect(silent.heard).toHaveLength(0);
  });

  it("the caster's own team always knows its own utility; the cue is the other team's", () => {
    const { views, cues } = run("a-lobby", "a-garden");
    const attackViews = views.filter((v) => v.side === "attack");
    expect(attackViews.some((v) => (v.visibleEffects ?? []).some((e) => e.own && e.effectType === "smoke" && e.zoneId === "a-main"))).toBe(true);
    expect(attackViews.flatMap((v) => v.observation.audibleEvents.filter((s) => s.kind === "abilityCast"))).toHaveLength(0);
    expect(cues).toHaveLength(0);
  });

  it("the team is told what its own abilities do (catalog facts), and nothing about the enemy's", () => {
    const { views } = run("a-lobby", "a-site");
    const atk = views.find((v) => v.side === "attack")!;
    const def = views.find((v) => v.side === "defense")!;
    expect(atk.abilityFacts?.[SMOKE]).toMatchObject({ effectType: "smoke", durationMs: 15000 });
    expect(def.abilityFacts).toEqual({});
  });

  it("confidence: under the audible threshold there is no cue at all", () => {
    expect(abilityCastCueConfidence(1)).toBeCloseTo(0.42);
    expect(abilityCastCueConfidence(0.4)).toBe(0); // 0.4 × 0.7 < 0.3
  });

  it("same seed and state → identical cues", () => {
    expect(run("a-main", "a-site", 9).cues).toEqual(run("a-main", "a-site", 9).cues);
  });
});
