import { describe, it, expect } from "vitest";
import { RoundSimulator, DEFUSE_REACH_UNITS, type PolicyView, type SimState } from "../src/index.js";
import { catalog, player, scene, scripted, spatial, weapons, SMOKE } from "./fixtures/ability-scenes.js";

/** A point of a zone's floor that is NOT on its plant area (a roadmap node outside the polygon). */
function offArea(zoneId: string) {
  const nav = spatial.nav!;
  for (let n = 0; ; n++) {
    const p = nav.nodePosition(n);
    if (nav.zoneAt(p) === zoneId && !spatial.isPointPlantable(p)) return p;
  }
}

describe("plant and defuse are decided by position (site polygon, distance to the spike)", () => {
  it("a carrier inside the site zone but off its plant area walks onto the area, then plants inside the polygon", () => {
    const atk = player("atk", "attack", "a-site");
    atk.position = { ...offArea("a-site") };
    const state = scene([atk, player("def", "defense", "b-site")], 30_000, "atk");
    const r = new RoundSimulator({
      spatial, weapons, abilities: catalog,
      policies: { attack: scripted(() => ({ kind: "plant" })), defense: scripted(() => undefined) },
      config: { seed: 1, roundTimeMs: 30_000, traceCommands: true },
    }).runRound(state);
    expect(r.commandTrace!.some((e) => e.phase === "plant" && e.result === "notOnPlantArea")).toBe(true);
    expect(r.events.some((e) => e.kind === "planted")).toBe(true);
    expect(spatial.isPointPlantable(state.spike.position!)).toBe(true);
  });

  it("a defender is not defusing until it stands within reach of the spike, wherever its zone", () => {
    const spikeAt = spatial.standPosition("a-site");
    const def = player("def", "defense", "a-site");
    def.position = { ...offArea("a-site") };
    const state: SimState = {
      ...scene([def, player("atk", "attack", "b-site")], 0),
      spike: { phase: "planted", carrierId: null, zoneId: "a-site", position: { ...spikeAt }, plantProgressMs: 0, defuseProgressMs: 0, defuserId: null, detonateAtElapsedMs: 45_000 },
    };
    const sim = new RoundSimulator({
      spatial, weapons, abilities: catalog,
      policies: { attack: scripted(() => undefined), defense: scripted(() => ({ kind: "defuse" })) },
      config: { seed: 2, traceCommands: true, recordTracks: true },
    });
    const r = sim.runRound(state);
    expect(r.commandTrace!.some((e) => e.phase === "defuse" && e.result === "notAtSpike")).toBe(true);
    const start = r.events.find((e) => e.kind === "defuseStart")!;
    expect(start).toBeDefined();
    const at = r.tracks!.find((f) => f.tick === start.tick)!.players.find((p) => p.id === "def")!;
    expect(Math.hypot(at.x - spikeAt.x, at.y - spikeAt.y)).toBeLessThanOrEqual(DEFUSE_REACH_UNITS);
    expect(r.reason).toBe("spikeDefused");
  });
});

describe("thrown effects sit where they land", () => {
  it("a smoke lands on the target zone's floor, not on its callout centre, and blocks sight as a volume", () => {
    const smk = player("smk", "attack", "a-lobby", [SMOKE]);
    const state = scene([smk, player("def", "defense", "a-site")], 3_000);
    const defViews: PolicyView[] = [];
    const r = new RoundSimulator({
      spatial, weapons, abilities: catalog,
      policies: { attack: scripted(() => ({ kind: "useAbility", abilityId: SMOKE, targetZone: "a-main", aimZone: "a-site" })), defense: scripted(() => undefined, defViews) },
      config: { seed: 1, roundTimeMs: 3_000, recordTracks: true },
    }).runRound(state);
    expect(r.events.some((e) => e.kind === "abilityUsed")).toBe(true);
    // landed on A main's side facing A site: nearer A site than A main's callout is
    const nav = spatial.nav!;
    const expected = nav.nodePosition(nav.locateInZone(spatial.standPosition("a-site"), "a-main", Number.POSITIVE_INFINITY)!);
    const centre = spatial.getZone("a-main")!.position;
    const site = spatial.getZone("a-site")!.position;
    expect(Math.hypot(expected.x - site.x, expected.y - site.y)).toBeLessThan(Math.hypot(centre.x - site.x, centre.y - site.y));
    // the defenders, who see it, place it there too (their map change carries the effect's origin)
    const seen = defViews.flatMap((v) => v.observation.knownMapChanges).find((m) => m.note === "smoke:enemy:a-main");
    expect(seen?.approxPosition).toEqual({ x: expected.x, y: expected.y, z: expected.z });
  });
});
