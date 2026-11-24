/**
 * Counterfactual tests for the information layer in the team policy: the IGL decides on what was
 * CALLED. The same sound, heard by the B anchor, moves the defense only once the call reaches the
 * IGL; a late call moves it later; a wrong call moves it wrongly; the pooled engine (layer off)
 * moves at once.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { TeamDecisionPolicy, viewFromTeamContext, type TeamPolicyOptions } from "@pv/team-engine";
import { AVERAGE_INFO_PROFILE, type InfoProfile } from "@pv/decision-engine";
import { loadDecisionContext } from "@pv/world-state";
import { SeededRng } from "@pv/simulation-core";
import type { ObservationState, PolicyView, Vector3 } from "@pv/shared-types";
import { AscentSpatialStub } from "./fixtures/ascent-stub.js";

const here = dirname(fileURLToPath(import.meta.url));
const spatial = new AscentSpatialStub();
const rng = (seed: number | string) => new SeededRng(seed).stream("policy");
const loadView = (s: string): PolicyView =>
  viewFromTeamContext(loadDecisionContext(JSON.parse(readFileSync(join(here, "fixtures", "scenarios", `scenario_${s}.json`), "utf8"))));
const AT: Record<string, Vector3> = {
  "a-site": { x: 780, y: 360, z: 0 }, "b-main": { x: 280, y: 615, z: 0 }, "b-site": { x: 230, y: 360, z: 0 },
  "mid-courtyard": { x: 500, y: 505, z: 0 }, "b-lobby": { x: 350, y: 820, z: 0 },
};
const zonePosition = (id: string) => AT[id];

const POSTS = ["a-site", "a-site", "b-site", "b-site", "mid-courtyard"];
/** Defense pre-plant holding 2-2-1; the listener (default the B anchor, index 2) hears `n` runners at `zone` while `hearing`. */
function holding(now: number, n: number, hearing: boolean, zone = "b-main", listener = 2): PolicyView {
  const base = loadView("03");
  const teammates = base.teammates.map((p, i) => ({ ...p, alive: true, position: AT[POSTS[i]!]! }));
  const empty = (t: number): ObservationState => ({ ...base.observation, timestampMs: t, visibleEnemies: [], audibleEvents: [], teammateReports: [] });
  const anchor = String(teammates[listener]!.id);
  const perPlayer: Record<string, ObservationState> = Object.fromEntries(teammates.map((p) => [String(p.id), empty(now)]));
  const sounds = hearing ? Array.from({ length: n }, () => ({ kind: "footstep" as const, approxPosition: AT[zone]!, heardAtMs: now, confidence: 0.8 })) : [];
  perPlayer[anchor] = { ...empty(now), audibleEvents: sounds };
  return {
    ...base, roundNumber: 5, knownEnemyAliveCount: 5, timeRemainingMs: now,
    economy: { ...base.economy, credits: 4500 }, teammates,
    spike: { phase: "carried", position: null, holderId: null, detonationInMs: null },
    belief: { ...base.belief, enemyPositionBeliefs: [] },
    observation: { ...empty(now), audibleEvents: sounds }, // the pooled picture: everyone "knows" at once
    perPlayerObservation: perPlayer,
  };
}

/** The IGL is the A anchor (index 0): best call quality. `anchor` overrides the B anchor's attributes. */
function infoProfiles(view: PolicyView, anchor: Partial<InfoProfile> = {}, igl: Partial<InfoProfile> = {}): Map<string, InfoProfile> {
  return new Map(view.teammates.map((p, i) => [String(p.id), {
    key: String(p.id), ...AVERAGE_INFO_PROFILE,
    ...(i === 0 ? { callQuality: 0.9, ...igl } : {}),
    ...(i === 2 ? anchor : {}),
  }]));
}

/** A seed whose opening is the plain hold, so a rotation is the only thing that moves anyone. */
function holdSeed(options: TeamPolicyOptions): number {
  for (let seed = 0; seed < 300; seed++) {
    const p = new TeamDecisionPolicy(spatial, options);
    if (p.decideWithTrace(holding(80_500, 0, false), rng(seed)).trace.plan.opening === "defaultHold") return seed;
  }
  throw new Error("no seed opens defaultHold");
}

/**
 * Play decisions every 500 ms from 80 000: the anchor hears `n` runners for `hearMs`, then silence.
 * Returns the clock (ms remaining) of the first decision that sent anyone to rotate, or null.
 */
function firstRotation(n: number, opts: { anchor?: Partial<InfoProfile>; igl?: Partial<InfoProfile>; options?: TeamPolicyOptions; hearMs?: number; until?: number; zone?: string; listener?: number } = {}) {
  const options: TeamPolicyOptions = { zonePosition, information: true, ...opts.options };
  const seed = holdSeed(options);
  const policy = new TeamDecisionPolicy(spatial, options);
  const r = rng(seed);
  const first = holding(80_500, 0, false);
  policy.setInfoProfiles(infoProfiles(first, opts.anchor, opts.igl));
  policy.decideWithTrace(first, r);
  const hearUntil = 80_000 - (opts.hearMs ?? 0);
  for (let now = 80_000; now >= (opts.until ?? 75_000); now -= 500) {
    const view = holding(now, n, now >= hearUntil, opts.zone, opts.listener);
    const { decision } = policy.decideWithTrace(view, r);
    const sent = decision.commands.filter((c) => c.sourceActionId?.startsWith("rotate:"));
    if (sent.length > 0) return { atMs: now, sent: sent.length, policy };
  }
  return { atMs: null, sent: 0, policy };
}

describe("the IGL decides on what was called (information layer in the team policy)", () => {
  it("counterfactual — pooled picture rotates at once; called picture rotates when the call lands", () => {
    const pooled = firstRotation(5, { options: { information: false } });
    const called = firstRotation(5);
    expect(pooled.atMs).toBe(80_000);
    expect(called.atMs).not.toBeNull();
    expect(called.atMs!).toBeLessThan(80_000); // after the anchor's call has been made and taken in
    expect(called.sent).toBe(pooled.sent); // same information, same response — only later
    const call = called.policy.informationTrace()!.comms.find((c) => c.kind === "footstep")!;
    expect(call.knownZone).toBe("b-main");
    expect(80_000 - called.atMs!).toBeGreaterThanOrEqual(call.iglAtMs! - call.sensedAtMs - 500);
  });

  it("counterfactual — a late caller (poor comms, no composure, blinded mid-fight) moves the defense later", () => {
    const sharp = firstRotation(5, { anchor: { communication: 1, composure: 1 } });
    const late = firstRotation(5, { anchor: { communication: 0, composure: 0 } });
    expect(sharp.atMs).not.toBeNull();
    expect(late.atMs).not.toBeNull();
    expect(late.atMs!).toBeLessThan(sharp.atMs!);
  });

  it("counterfactual — the same two runners: called right, the defense holds; called as three, it sends help", () => {
    const exact = firstRotation(2, { options: { informationDraw: () => 0.99 }, hearMs: 1500 });
    const wrong = firstRotation(2, { options: { informationDraw: (s) => (s.startsWith("acc|") ? 0 : 0.6) }, hearMs: 1500 });
    expect(exact.atMs).toBeNull();
    expect(wrong.atMs).not.toBeNull();
    expect(wrong.policy.informationTrace()!.comms.some((c) => c.accuracy === "wrongCount" && c.count === 3)).toBe(true);
  });

  it("counterfactual — runners in mid: called as mid, the defense holds; called as B site, it rotates to B", () => {
    const at = { zone: "mid-courtyard", listener: 4, hearMs: 1500 };
    const right = firstRotation(5, { ...at, options: { informationDraw: () => 0.99 } });
    const wrong = firstRotation(5, { ...at, options: { informationDraw: (s) => (s.startsWith("acc|") ? 0 : 0.3) } });
    const call = wrong.policy.informationTrace()!.comms.find((c) => c.kind === "footstep")!;
    expect(call.accuracy).toBe("wrongZone");
    expect(call.knownZone).toBe("mid-courtyard");
    expect(call.zone).toBe("b-site");
    expect(right.atMs).toBeNull(); // noise in mid is not a hit on a site
    expect(wrong.atMs).not.toBeNull(); // the IGL acts on what it was told
    expect(wrong.policy.planSummary()!.rotations?.at(-1)?.site).toBe("B");
  });

  it("a slower IGL acts later on the same call", () => {
    const quick = firstRotation(5, { igl: { callQuality: 1 }, anchor: { callQuality: 0 } });
    const slow = firstRotation(5, { igl: { callQuality: 0.6 }, anchor: { callQuality: 0 } });
    const q = quick.policy.informationTrace()!.comms.find((c) => c.kind === "footstep")!;
    const s = slow.policy.informationTrace()!.comms.find((c) => c.kind === "footstep")!;
    expect(s.iglAtMs! - s.deliveredAtMs).toBeGreaterThan(q.iglAtMs! - q.deliveredAtMs);
    expect(slow.atMs!).toBeLessThanOrEqual(quick.atMs!);
  });
});
