/**
 * Engine wiring for the Match Runner: spatial engine, weapons catalog, abilities, and the
 * PV-3 TeamDecisionPolicy wrapped to the round-simulator's PolicyView contract.
 *
 * The policy wrapper mirrors the integration E2E test (integration-adapters/test/
 * e2e.integration.test.ts): the sim's teammate perception subset omits fields PV-3's policy
 * reads, and uses a different abilities shape, so `normalizeView` forces PV-3's shared-types
 * shapes and fills the belief PV-3 owns (perception produces observation only). R2-B: PV-4 to
 * populate the contract teammate fields natively so this backfill can be dropped.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine, type SpatialEngine } from "@pv/spatial-engine";
import { buildCatalog, type WeaponSpec } from "@pv/combat-engine";
import type { AbilityCatalog } from "@pv/ability-engine";
import type { Side, DecisionPolicy as SimDecisionPolicy } from "@pv/round-simulator";
import { TeamDecisionPolicy, type OpponentRead, type PlanSummary, type PolicyOrder, type PolicyTuning } from "@pv/team-engine";
import { buildBeliefState } from "@pv/decision-engine";
import { spatialQueryFromEngine } from "@pv/integration-adapters";
import type { DecisionPolicy, PlayerProfile, PlayerState, PolicyView, RandomSource, SpatialQuery } from "@pv/shared-types";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

/** Load the Ascent spatial engine from the shared dataset (datasets/spatial/ascent). */
export function loadSpatial(): SpatialEngine {
  const dir = resolve(repoRoot, "datasets/spatial/ascent");
  const nav = JSON.parse(readFileSync(resolve(dir, "ascent.navgraph.json"), "utf8"));
  const cs = JSON.parse(readFileSync(resolve(dir, "coordinate-system.json"), "utf8"));
  return createEngine(nav, cs.transform);
}

/** Load the manual-approx weapons catalog (match-runner owns its copy under ./data). */
export function loadWeapons(): Record<string, WeaponSpec> {
  const raw = JSON.parse(readFileSync(resolve(here, "..", "data", "weapons.manual-approx.json"), "utf8"));
  return buildCatalog(raw.weapons as WeaponSpec[]);
}

export const NO_ABILITIES: AbilityCatalog = {};

/**
 * Build a SpatialQuery over the engine. The internal frame is game world units, so the
 * minimap→game transform is identity (sim positions are already world units; F1 decision).
 */
export function makeSpatialQuery(spatial: SpatialEngine): SpatialQuery {
  return spatialQueryFromEngine(spatial, { minimapToGame: (v) => ({ x: v.x, y: v.y }) });
}

/**
 * Wrap PV-3's TeamDecisionPolicy for the round-simulator. Backfills the teammate fields the
 * sim's perception subset omits and fills the belief PV-3 owns, then delegates.
 */
export class WrappedTeamPolicy implements DecisionPolicy {
  private readonly inner: TeamDecisionPolicy;
  constructor(private readonly sq: SpatialQuery, abilityEffect?: (abilityId: string) => string | undefined) {
    this.inner = new TeamDecisionPolicy(sq, abilityEffect ? { abilityEffect } : {});
  }
  /** Set/clear the coach order for upcoming decisions (interactive-session timeouts). */
  setOrder(order: PolicyOrder | null): void {
    this.inner.setOrder(order);
  }
  /** Bind the real roster's decision profiles (keyed by this round's sim player ids). */
  setProfiles(profiles: ReadonlyMap<string, PlayerProfile> | null): void {
    this.inner.setProfiles(profiles);
  }
  /** The plan of the round just played (opening call, final call, revisions). */
  planSummary(): PlanSummary | null {
    return this.inner.planSummary();
  }
  /** The team's cross-round read of its opponent (null = play without memory). */
  setOpponentRead(read: OpponentRead | null): void {
    this.inner.setOpponentRead(read);
  }
  setTuning(tuning: Partial<PolicyTuning> | null): void {
    this.inner.setTuning(tuning);
  }
  setThrowFloors(floors: ReadonlyMap<string, number> | null): void {
    this.inner.setThrowFloors(floors);
  }
  private normalize(view: PolicyView): PolicyView {
    const teammates = view.teammates.map((p): PlayerState => ({
      ...p,
      weapon: p.weapon ?? null,
      inventory: { primary: null, secondary: null, armor: { type: "none", points: p.armor ?? 0 }, hasSpike: false },
      // Keep the sim's real ability inventory (built from the loadout) so the action-generator
      // can emit useAbility candidates; fall back to an empty one only if the sim omits it.
      abilities: p.abilities ?? { basic: [], signature: null, ultimate: { abilityId: `${p.agentId}:x` as never, points: p.ultimatePoints ?? 0, required: 7, ready: false } },
      credits: p.credits ?? 0, ultimatePoints: p.ultimatePoints ?? 0,
      velocity: { x: 0, y: 0, z: 0 }, behaviorState: "idle", currentOrderId: null,
    }));
    const belief = buildBeliefState(view.belief ?? null, view.observation, this.sq, 0);
    return { ...view, teammates, belief };
  }
  decide(view: PolicyView, rng: RandomSource) {
    return this.inner.decide(this.normalize(view), rng);
  }
}

/**
 * Build the per-side policy map for the RoundSimulator.
 *
 * The round-simulator mirrors PV-3's DecisionPolicy contract locally (policy-contract.ts)
 * with STRING ids where shared-types uses branded ids (TeamId/PlayerId). The two are
 * structurally identical and runtime-compatible, so this crosses the brand boundary with a
 * single localized cast (R2-B seam; harmless at runtime, see e2e.integration.test.ts).
 */
export function makeSimPolicies(
  sq: SpatialQuery,
  abilityEffect?: (abilityId: string) => string | undefined,
): Readonly<Record<Side, WrappedTeamPolicy>> {
  return { attack: new WrappedTeamPolicy(sq, abilityEffect), defense: new WrappedTeamPolicy(sq, abilityEffect) };
}

/** Cast the wrapped policies to the round-simulator's DecisionPolicy record (R2-B brand bridge). */
export function toSimPolicies(p: Readonly<Record<Side, WrappedTeamPolicy>>): Readonly<Record<Side, SimDecisionPolicy>> {
  return { attack: p.attack as unknown as SimDecisionPolicy, defense: p.defense as unknown as SimDecisionPolicy };
}
