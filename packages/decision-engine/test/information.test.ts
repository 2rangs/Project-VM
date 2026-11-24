/**
 * Information layer (information.ts): each player knows what they sensed, the team knows what was
 * called, the IGL decides on what it combined.
 */
import { describe, it, expect } from "vitest";
import {
  InformationLayer, CommsLedger, AVERAGE_INFO_PROFILE, callErrorChance, callReactionMs, claimWeight, reporterTrust,
  type InfoProfile, type InformationInput,
} from "@pv/decision-engine";
import type { BeliefState, ObservationState, PlayerState, SoundObservation, Vector3 } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const spatial = new AscentSpatialStub();
const AT: Record<string, Vector3> = {
  "attacker-spawn": { x: 500, y: 905, z: 0 }, "a-lobby": { x: 650, y: 820, z: 0 }, "a-main": { x: 720, y: 615, z: 0 },
  "a-site": { x: 780, y: 360, z: 0 }, "b-lobby": { x: 350, y: 820, z: 0 }, "b-main": { x: 280, y: 615, z: 0 },
  "b-site": { x: 230, y: 360, z: 0 }, "mid-courtyard": { x: 500, y: 505, z: 0 }, "mid-top": { x: 500, y: 250, z: 0 },
  "mid-bottom": { x: 500, y: 650, z: 0 }, "defender-spawn": { x: 500, y: 120, z: 0 },
};
const zoneCentre = (z: string) => AT[z];

const EMPTY_BELIEF = { playerId: "defenders", timestampMs: 0, enemyPositionBeliefs: [], tacticalHypotheses: [], threatZones: [], confidence: 0.3 } as unknown as BeliefState;

function mate(id: string, zone: string, over: Partial<PlayerState> = {}): PlayerState {
  return { id, teamId: "defenders", side: "defense", position: AT[zone]!, health: 100, alive: true, ...over } as unknown as PlayerState;
}
function obs(now: number, over: Partial<ObservationState> = {}): ObservationState {
  return { observerId: "x", teamId: "defenders", timestampMs: now, visibleEnemies: [], audibleEvents: [], teammateReports: [], knownMapChanges: [], ...over } as unknown as ObservationState;
}
const steps = (zone: string, n: number, now: number): SoundObservation[] =>
  Array.from({ length: n }, () => ({ kind: "footstep" as const, approxPosition: AT[zone]!, heardAtMs: now, confidence: 0.8 }));

interface Tick {
  now: number;
  mates: PlayerState[];
  perPlayer: Record<string, ObservationState>;
  pooled?: Partial<ObservationState>;
}
function input(t: Tick, profiles?: ReadonlyMap<string, InfoProfile>): InformationInput {
  return {
    view: {
      contextId: "r1", timeRemainingMs: t.now, spike: { detonationInMs: null }, teammates: t.mates,
      observation: obs(t.now, t.pooled), perPlayerObservation: t.perPlayer, belief: EMPTY_BELIEF,
    },
    ...(profiles ? { profiles } : {}),
  };
}
/** def1 is the IGL (best call quality); others average unless overridden. */
function profiles(over: Record<string, Partial<InfoProfile>> = {}): Map<string, InfoProfile> {
  const ids = ["def1", "def2", "def3"];
  return new Map(ids.map((id) => [id, { key: id, ...AVERAGE_INFO_PROFILE, ...(id === "def1" ? { callQuality: 0.9 } : {}), ...over[id] }]));
}
const footstepsIn = (o: ObservationState, zone: string) => o.audibleEvents.filter((e) => e.kind === "footstep" && spatial.nearestZone(e.approxPosition) === zone).length;

describe("information layer — what is not called does not reach the team", () => {
  const mates = [mate("def1", "a-site"), mate("def2", "b-site"), mate("def3", "mid-courtyard")];

  it("a teammate's sound is absent from the team picture until the call has been made and taken in", () => {
    const layer = new InformationLayer(spatial, { zoneCentre });
    const prof = profiles();
    const heard = (now: number) => ({ def2: obs(now, { audibleEvents: steps("b-main", 3, now) }) });
    const t0 = layer.step(input({ now: 80_000, mates, perPlayer: heard(80_000) }, prof));
    expect(footstepsIn(t0.observation, "b-main")).toBe(0); // def2 heard it; nobody else knows yet
    expect(t0.iglId).toBe("def1");
    let later = t0;
    for (let now = 79_500; now >= 78_000; now -= 500) later = layer.step(input({ now, mates, perPlayer: heard(now) }, prof));
    expect(footstepsIn(later.observation, "b-main")).toBe(3); // "three B main"
    const call = layer.trace().comms.find((c) => c.from === "def2" && c.kind === "footstep")!;
    expect(call.deliveredAtMs).toBeGreaterThan(call.sensedAtMs);
    expect(call.iglAtMs!).toBeGreaterThan(call.deliveredAtMs);
  });

  it("the IGL's own senses need no call", () => {
    const layer = new InformationLayer(spatial, { zoneCentre });
    const out = layer.step(input({ now: 80_000, mates, perPlayer: { def1: obs(80_000, { audibleEvents: steps("a-main", 2, 80_000) }) } }, profiles()));
    expect(footstepsIn(out.observation, "a-main")).toBe(2);
  });

  it("a burst of information overloads a weak caller: the calls that would come too late are never made", () => {
    const layer = new InformationLayer(spatial, { zoneCentre });
    const prof = profiles({ def3: { communication: 0, composure: 0 } });
    const zones = ["mid-top", "mid-bottom", "a-main", "b-main", "a-lobby", "b-lobby", "attacker-spawn"];
    const burst = (now: number) => ({ def3: obs(now, { audibleEvents: zones.map((z) => ({ kind: "gunfire" as const, approxPosition: AT[z]!, heardAtMs: 80_000, confidence: 0.8 })) }) });
    layer.step(input({ now: 80_000, mates, perPlayer: burst(80_000) }, prof));
    let out = layer.step(input({ now: 79_500, mates, perPlayer: {} }, prof));
    for (let now = 79_000; now >= 74_000; now -= 500) out = layer.step(input({ now, mates, perPlayer: {} }, prof));
    const calls = layer.trace().comms.filter((c) => c.from === "def3");
    const dropped = calls.filter((c) => c.dropped);
    expect(dropped.length).toBeGreaterThan(0);
    const known = new Set(out.observation.audibleEvents.map((e) => spatial.nearestZone(e.approxPosition)));
    for (const d of dropped) expect(known.has(d.zone as never)).toBe(false);
    expect(known.size).toBe(calls.length - dropped.length);
  });
});

describe("information layer — a dead player's last call", () => {
  it("the player who dies makes one last call, queued calls are lost, then silence", () => {
    const layer = new InformationLayer(spatial, { zoneCentre });
    const prof = profiles();
    const alive = [mate("def1", "a-site"), mate("def2", "b-site"), mate("def3", "mid-courtyard")];
    layer.step(input({ now: 80_000, mates: alive, perPlayer: {} }, prof));
    // def2 is shot on B site and dies between decisions (no one saw the shooter)
    const dead = [alive[0]!, mate("def2", "b-site", { alive: false, health: 0 }), alive[2]!];
    let out = layer.step(input({ now: 79_500, mates: dead, perPlayer: {} }, prof));
    for (let now = 79_000; now >= 77_000; now -= 500) out = layer.step(input({ now, mates: dead, perPlayer: {} }, prof));
    const calls = layer.trace().comms.filter((c) => c.from === "def2");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.lastCall).toBe(true);
    expect(calls[0]!.knownZone).toBe("b-site");
    // the team now knows there is a gun on B site
    expect(out.observation.audibleEvents.some((e) => e.kind === "gunfire" && spatial.nearestZone(e.approxPosition) === "b-site")).toBe(true);
  });

  it("the last call carries what the dying player last saw", () => {
    const layer = new InformationLayer(spatial, { zoneCentre, draw: () => 0.99 }); // exact calls
    const prof = profiles();
    const alive = [mate("def1", "a-site"), mate("def2", "b-site"), mate("def3", "mid-courtyard")];
    const sees = { def2: obs(80_000, { visibleEnemies: [{ playerId: "atk4", agentId: null, lastSeenPosition: AT["b-main"]!, lastSeenAtMs: 80_000, healthBand: "unknown", observedWeaponId: null, currentlyVisible: false }] }) } as never;
    // remembered (not currently visible) sighting: no minimap spot, only def2 knows — make it known to def2 first
    layer.step(input({ now: 80_000, mates: alive, perPlayer: { def2: obs(80_000, { visibleEnemies: [{ ...(sees as Record<string, ObservationState>).def2!.visibleEnemies[0]!, currentlyVisible: true }] }) } }, prof));
    const dead = [alive[0]!, mate("def2", "b-site", { alive: false, health: 0 }), alive[2]!];
    layer.step(input({ now: 79_900, mates: dead, perPlayer: {} }, prof));
    const last = layer.trace().comms.find((c) => c.from === "def2" && c.lastCall)!;
    expect(last.enemyId).toBe("atk4");
    expect(last.zone).toBe("b-main");
    // the call made at sighting was in flight before the death; nothing after the last call
    expect(layer.trace().comms.filter((c) => c.from === "def2" && !c.dropped && c.startedAtMs > last.startedAtMs)).toHaveLength(0);
  });
});

describe("information layer — wrong calls and trust", () => {
  const mates = [mate("def1", "a-site"), mate("def2", "b-site"), mate("def3", "mid-courtyard")];
  const heard = (now: number) => ({ def2: obs(now, { audibleEvents: steps("b-main", 2, now) }) });
  const run = (draw: (s: string) => number) => {
    const layer = new InformationLayer(spatial, { zoneCentre, draw });
    let out = layer.step(input({ now: 80_000, mates, perPlayer: heard(80_000) }, profiles()));
    for (let now = 79_500; now >= 78_000; now -= 500) out = layer.step(input({ now, mates, perPlayer: {} }, profiles()));
    return { out, layer };
  };

  it("a wrong count reaches the team as said, not as heard", () => {
    const exact = run(() => 0.99);
    const wrong = run((s) => (s.startsWith("acc|") ? 0 : 0.6)); // wrong; count +1
    expect(footstepsIn(exact.out.observation, "b-main")).toBe(2);
    expect(footstepsIn(wrong.out.observation, "b-main")).toBe(3);
    expect(wrong.layer.trace().comms[0]!.accuracy).toBe("wrongCount");
  });

  it("a wrong zone points the team at the wrong place", () => {
    const wrong = run((s) => (s.startsWith("acc|") ? 0 : 0.1)); // wrong; zone (first neighbour)
    expect(footstepsIn(wrong.out.observation, "b-main")).toBe(0);
    expect(wrong.layer.trace().comms[0]!.accuracy).toBe("wrongZone");
  });

  it("trust follows the track record: confirmed calls raise it, refuted ones lower it", () => {
    const base = { ...AVERAGE_INFO_PROFILE };
    const fresh = reporterTrust(base, undefined, { confirmed: 0, refuted: 0 });
    expect(reporterTrust(base, undefined, { confirmed: 4, refuted: 0 })).toBeGreaterThan(fresh);
    expect(reporterTrust(base, undefined, { confirmed: 0, refuted: 4 })).toBeLessThan(fresh);
    expect(reporterTrust(base, "lurker", { confirmed: 0, refuted: 0 })).toBeGreaterThan(fresh);
  });

  it("a call refuted by the minimap costs the caller trust in the match ledger", () => {
    const ledger = new CommsLedger();
    const layer = new InformationLayer(spatial, { zoneCentre, draw: (s) => (s.startsWith("acc|") ? 0 : 0.1) }); // every call wrong-zone
    layer.setLedger(ledger);
    const enemy = (zone: string, now: number, live = true) => ({ playerId: "atk1", agentId: null, lastSeenPosition: AT[zone]!, lastSeenAtMs: now, healthBand: "unknown", observedWeaponId: null, currentlyVisible: live });
    // def2 sees atk1 on b-main and calls it (wrong zone); the minimap shows atk1 on b-main
    for (let now = 80_000; now >= 78_000; now -= 500) {
      layer.step(input({ now, mates, perPlayer: { def2: obs(now, { visibleEnemies: [enemy("b-main", now) as never] }) } }, profiles()));
    }
    const said = layer.trace().comms.find((c) => c.from === "def2" && c.kind === "sighting")!;
    expect(said.zone).not.toBe("b-main");
    const adjacentToTruth = ["b-lobby", "b-site"].includes(said.zone);
    const rec = ledger.get("def2");
    // a call one zone off is "close enough" (confirmed); further is refuted
    expect(rec.confirmed + rec.refuted).toBeGreaterThan(0);
    if (!adjacentToTruth) expect(rec.refuted).toBeGreaterThan(0);
  });
});

describe("information layer — the formulas move with the attributes", () => {
  it("a better communicator calls sooner and more accurately; load slows and degrades a call", () => {
    const good = { ...AVERAGE_INFO_PROFILE, communication: 0.9, awareness: 0.9 };
    const poor = { ...AVERAGE_INFO_PROFILE, communication: 0.2, awareness: 0.2 };
    expect(callReactionMs(good, 0)).toBeLessThan(callReactionMs(poor, 0));
    expect(callErrorChance(good, 0).wrong).toBeLessThan(callErrorChance(poor, 0).wrong);
    expect(callReactionMs(poor, 1)).toBeGreaterThan(callReactionMs(poor, 0));
    expect(callErrorChance(poor, 1).partial).toBeGreaterThan(0);
    // composure absorbs load
    expect(callReactionMs({ ...poor, composure: 1 }, 1)).toBe(callReactionMs(poor, 0));
  });
  it("claims weigh recency × confidence × trust^q", () => {
    expect(claimWeight(0, 1, 1, 0.6)).toBe(1);
    expect(claimWeight(5000, 1, 1, 0.6)).toBeCloseTo(0.5);
    expect(claimWeight(0, 1, 0.5, 1)).toBeLessThan(claimWeight(0, 1, 0.5, 0)); // a sharp IGL discounts a shaky source
  });
  it("is deterministic", () => {
    const mates = [mate("def1", "a-site"), mate("def2", "b-site"), mate("def3", "mid-courtyard")];
    const play = () => {
      const layer = new InformationLayer(spatial, { zoneCentre });
      for (let now = 80_000; now >= 76_000; now -= 500) {
        layer.step(input({ now, mates, perPlayer: { def2: obs(now, { audibleEvents: steps("b-main", 2 + (now % 1000 === 0 ? 1 : 0), now) }) } }, profiles()));
      }
      return JSON.stringify(layer.trace());
    };
    expect(play()).toBe(play());
  });
});
