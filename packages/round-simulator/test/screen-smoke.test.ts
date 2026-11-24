import { describe, it, expect } from "vitest";
import { segmentHitsSphere, EYE_HEIGHT_UNITS } from "@pv/perception-engine";
import { RoundSimulator, type ActionCommand, type PolicyView } from "../src/index.js";
import { catalog, charges, player, scene, scripted, spatial, weapons, SMOKE } from "./fixtures/ability-scenes.js";

/**
 * Where a cover smoke lands decides whether it helps the team or kills it. Same smoker, same smoke,
 * same walk — one condition changed: the order says "smoke the lane" (targetZone A main, side facing
 * A site — the old cover smoke) or "hide the lane from A site" (targetZone A site, screenZone A main).
 *
 *   `smk` stands in A lobby and throws on the first decision. `atk` waits one decision, then walks
 *   A main → A site, where `def` holds facing A main.
 */
const nav = spatial.nav!;
const RADIUS = catalog[SMOKE]!.radiusUnits!;
const walkway = (() => {
  const r = nav.findPath({ actorId: "t", start: spatial.standPosition("a-main"), destination: spatial.standPosition("a-site"), movementMode: "run", routePreference: "FASTEST" });
  return r.status === "SUCCESS" ? r.waypoints.map((w) => w.position) : [];
})();

function run(order: "lane" | "screen", seed = 3) {
  const cast: Omit<ActionCommand, "playerId"> = order === "lane"
    ? { kind: "useAbility", abilityId: SMOKE, targetZone: "a-main", aimZone: "a-site" }
    : { kind: "useAbility", abilityId: SMOKE, targetZone: "a-site", screenZone: "a-main" };
  const defViews: PolicyView[] = [];
  const attack = scripted((p, v) => {
    if (p.id === "smk") return charges(p, SMOKE) > 0 ? cast : undefined;
    return v.timeRemainingMs > 9500 ? undefined : { kind: "move", targetZone: "a-site", moveMode: "run" };
  });
  const state = scene([player("atk", "attack", "a-main"), player("smk", "attack", "a-lobby", [SMOKE]), player("def", "defense", "a-site")], 10_000, "atk");
  const r = new RoundSimulator({
    spatial, weapons, abilities: catalog,
    policies: { attack, defense: scripted(() => ({ kind: "hold", aimZone: "a-main" }), defViews) },
    config: { seed, roundTimeMs: 10_000, traceCommands: true },
  }).runRound(state);
  const smokeAt = defViews.flatMap((v) => v.observation.knownMapChanges).find((m) => m.note.startsWith("smoke:enemy"))?.approxPosition;
  const duel = (r.engagementTrace ?? []).find((e) => e.attackerId === "atk");
  return { r, smokeAt, duel };
}
const offWalkway = (q: { x: number; y: number }) => Math.min(...walkway.map((w) => Math.hypot(w.x - q.x, w.y - q.y)));
/** Of the sightlines from A site's floor onto A main's floor, how many a smoke at `c` cuts. */
function cut(c: { x: number; y: number; z: number }): number {
  const eye = (n: number) => { const q = nav.nodePosition(n); return { x: q.x, y: q.y, z: q.z + EYE_HEIGHT_UNITS }; };
  let n = 0;
  for (const w of nav.zoneNodes("a-site")) for (const l of nav.zoneNodes("a-main")) if (nav.nodesVisible(w, l) && segmentHitsSphere(eye(w), eye(l), c, RADIUS)) n++;
  return n;
}

describe("a cover smoke hides the lane from the holders — it is not put on the lane", () => {
  it("the walkway exists and the map has a sight table (preconditions)", () => {
    expect(walkway.length).toBeGreaterThan(1);
    expect(nav.hasVisibility).toBe(true);
  });

  it("counterfactual — order: the lane smoke sits on the walkway, the screening smoke keeps a body's width off it", () => {
    const lane = run("lane").smokeAt!;
    const screen = run("screen").smokeAt!;
    expect(lane).toBeDefined();
    expect(screen).toBeDefined();
    expect(offWalkway(lane)).toBeLessThan(RADIUS);
    expect(offWalkway(screen)).toBeGreaterThan(RADIUS);
    // and it still cuts the holders' view of the lane — it was put where it cuts the most of it
    expect(cut(screen)).toBeGreaterThan(0);
  });

  it("counterfactual — consequence: through the lane smoke the entry comes out of smoke into a watched edge; beside the screening smoke it does not", () => {
    const lane = run("lane").duel;
    const screen = run("screen").duel;
    expect(lane?.smokeExit).toEqual({ attacker: true, defender: false, watched: true });
    expect(lane?.firstSight).toBe("defender");
    expect(screen?.smokeExit).toBeUndefined();
  });

  it("same seed and state → the identical round", () => {
    expect(run("screen", 9).r).toEqual(run("screen", 9).r);
  });
});
