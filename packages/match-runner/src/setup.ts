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
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine, deriveMapTactics, type MapTactics, type MapTacticsOverrides, type SpatialEngine } from "@pv/spatial-engine";
import { buildCatalog, type WeaponSpec } from "@pv/combat-engine";
import type { AbilityCatalog } from "@pv/ability-engine";
import { plantSpotAt, plantSpotsOf, type Side, type DecisionPolicy as SimDecisionPolicy } from "@pv/round-simulator";
import { TeamDecisionPolicy, type OpponentRead, type PlanSummary, type PolicyOrder, type PolicyTuning } from "@pv/team-engine";
import { buildBeliefState, type CommsLedger, type InfoProfile, type InformationTrace } from "@pv/decision-engine";
import { spatialQueryFromEngine } from "@pv/integration-adapters";
import { spikeBlastRadiusUnits, weaponPrice } from "@pv/game-rules";
import type { DecisionPolicy, MidControlState, PlantSpotRef, PlayerProfile, PlayerState, PolicyView, PostPlantPlans, RandomSource, ResolvedMidSidePlan, RetakePlans, SpatialQuery } from "@pv/shared-types";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..", "..");

/**
 * Parsed map / catalog data files, read and parsed once per process. A long-lived host (the desktop
 * engine worker, a series, a season batch) builds a new engine for every match from the same files;
 * the parsed JSON is shared between those builds and is never mutated (`createEngine`,
 * `deriveMapTactics` and `buildCatalog` only read it), so every match still gets its own engine.
 * A file that does not exist is remembered as `undefined`.
 */
const DATA_FILES = new Map<string, unknown>();
function readDataFile<T>(path: string): T | undefined {
  if (!DATA_FILES.has(path)) DATA_FILES.set(path, existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : undefined);
  return DATA_FILES.get(path) as T | undefined;
}
function requireDataFile<T>(path: string): T {
  const data = readDataFile<T>(path);
  if (data === undefined) throw new Error(`ENOENT: no such file or directory, open '${path}'`);
  return data;
}
/** Forget the parsed data files (tools that rewrite map data and reload it in the same process). */
export function clearDataFileCache(): void {
  DATA_FILES.clear();
}

/** Load a map's spatial engine — zone graph, coordinate system and navigation roadmap — from datasets/spatial/<map>. */
export function loadSpatial(mapId = "ascent"): SpatialEngine {
  const dir = resolve(repoRoot, "datasets/spatial", mapId);
  const nav = requireDataFile<Parameters<typeof createEngine>[0]>(resolve(dir, `${mapId}.navgraph.json`));
  const cs = requireDataFile<{ transform: Parameters<typeof createEngine>[1] }>(resolve(dir, "coordinate-system.json"));
  const roadmap = requireDataFile<Parameters<typeof createEngine>[2]>(resolve(dir, `${mapId}.nav.json`));
  // measured line of sight between roadmap nodes; without it sight falls back to the zone table
  const visibility = readDataFile<Parameters<typeof createEngine>[3]>(resolve(dir, `${mapId}.vis.json`));
  return createEngine(nav, cs.transform, roadmap, visibility);
}

/**
 * A map's tactical data (sites, the way in to each, what a defender watches, defender starts):
 * derived from its geometry, with its hand-authored `<map>.tactics.json` (if any) applied.
 */
export function loadTactics(mapId: string, spatial: SpatialEngine): MapTactics {
  const overrides = readDataFile<MapTacticsOverrides>(resolve(repoRoot, "datasets/spatial", mapId, `${mapId}.tactics.json`)) ?? {};
  return deriveMapTactics(spatial, overrides);
}

/**
 * A map's ultimate-orb points from `<map>.objects.json` `ultOrbs` (maps data). Accepts entries with
 * `position: {x, y, z}` or `x, y, z` (game uu) and an optional `id`. Empty when the file or the points
 * are missing — every map today: orbs are spawned actors the scene export does not contain.
 */
export function loadUltOrbs(mapId: string): { id: string; position: { x: number; y: number; z: number } }[] {
  const raw = readDataFile<{ ultOrbs?: unknown[] }>(resolve(repoRoot, "datasets/spatial", mapId, `${mapId}.objects.json`));
  if (!raw) return [];
  const out: { id: string; position: { x: number; y: number; z: number } }[] = [];
  (raw.ultOrbs ?? []).forEach((o, i) => {
    const r = o as { id?: unknown; position?: { x?: unknown; y?: unknown; z?: unknown }; x?: unknown; y?: unknown; z?: unknown };
    const src = r.position ?? r;
    const [x, y, z] = [src.x, src.y, src.z];
    if (typeof x !== "number" || typeof y !== "number") return;
    out.push({ id: typeof r.id === "string" ? r.id : `orb${i + 1}`, position: { x, y, z: typeof z === "number" ? z : 0 } });
  });
  return out;
}

let catalogCache: Record<string, WeaponSpec> | null = null;
function weaponCatalog(): Record<string, WeaponSpec> {
  return (catalogCache ??= loadWeapons());
}

/** Load the manual-approx weapons catalog (match-runner owns its copy under ./data). */
export function loadWeapons(opts: { modes?: boolean } = {}): Record<string, WeaponSpec> {
  const raw = requireDataFile<{ weapons: WeaponSpec[] }>(resolve(here, "..", "data", "weapons.manual-approx.json"));
  // (the cached rows are shared and never mutated: the mode strip below makes new objects)
  const weapons = raw.weapons.map((w) => {
    if (opts.modes) return w;
    // Without weapon modes (MatchConfig.weaponModes, default off): no alt-fire, no run-and-gun
    // accuracy — the six v1.2 guns duel exactly as before. Pellets stay (a shotgun needs them).
    const { altFire: _alt, movingAccuracy: _mov, ...rest } = w;
    return rest;
  });
  return buildCatalog(weapons);
}

export const NO_ABILITIES: AbilityCatalog = {};

/** Shop price of a weapon id as the sim names it ("Vandal" → game-rules key "vandal"). */
function shopPrice(weaponId: string): number | undefined {
  return weaponPrice(weaponId.toLowerCase())?.price.value;
}

/**
 * Build a SpatialQuery over the engine. The internal frame is game world units, so the
 * minimap→game transform is identity (sim positions are already world units; F1 decision).
 */
export function makeSpatialQuery(spatial: SpatialEngine): SpatialQuery {
  return spatialQueryFromEngine(spatial, { minimapToGame: (v) => ({ x: v.x, y: v.y }) });
}

/**
 * Share of a zone's roadmap nodes with measured line of sight to a point (the planted spike), cached
 * per zone and point. 0 when the point is off the roadmap or the zone has no nodes.
 */
export function pointSightOf(spatial: SpatialEngine): (zoneId: string, point: { x: number; y: number; z: number }) => number {
  const nav = spatial.nav!;
  const cache = new Map<string, number>();
  return (zoneId, point) => {
    const key = `${zoneId}|${Math.round(point.x)},${Math.round(point.y)},${Math.round(point.z)}`;
    let v = cache.get(key);
    if (v === undefined) {
      const target = nav.locate(point);
      const nodes = nav.zoneNodes(zoneId);
      v = target === null || nodes.length === 0 ? 0 : nodes.filter((n) => nav.nodesVisible(n, target)).length / nodes.length;
      cache.set(key, v);
    }
    return v;
  };
}

/** Which plant spot (site letter, candidate id and kind) a planted spike lies on (round-simulator plantSpotsOf). */
export function plantSpotRefOf(spatial: SpatialEngine): (point: { x: number; y: number; z: number }) => PlantSpotRef | null {
  const sites = plantSpotsOf(spatial);
  return (point) => {
    const zone = spatial.nav?.zoneAt(point) ?? null;
    let site = zone ? sites.get(zone) : undefined;
    if (!site) site = [...sites.values()].find((s) => plantSpotAt(s, point) !== null);
    if (!site) return null;
    const c = plantSpotAt(site, point);
    return { site: site.site, id: c?.id ?? null, kind: c?.kind ?? "other" };
  };
}

/**
 * Wrap PV-3's TeamDecisionPolicy for the round-simulator. Backfills the teammate fields the
 * sim's perception subset omits and fills the belief PV-3 owns, then delegates.
 */
export class WrappedTeamPolicy implements DecisionPolicy {
  private readonly inner: TeamDecisionPolicy;
  constructor(private readonly sq: SpatialQuery, abilityEffect?: (abilityId: string) => string | undefined, spatial?: SpatialEngine, tactics?: MapTactics, plantTactics = false, midControl = false, information = false, ecoDefenseStack = false) {
    this.inner = new TeamDecisionPolicy(sq, {
      ...(information ? { information: true } : {}),
      ...(tactics ? { tactics } : {}),
      ...(ecoDefenseStack ? { ecoDefenseStack: true } : {}),
      midControl,
      ...(abilityEffect ? { abilityEffect } : {}),
      weaponPrice: shopPrice,
      weaponFullDamageRangeM: (id: string) => weaponCatalog()[id]?.damageBands[0]?.maxRangeMeters,
      // Footsteps carry as far as the spike's blast (game-rules); zone centres let a player judge
      // whether a run is inside an enemy's hearing.
      footstepRadiusUnits: spikeBlastRadiusUnits(),
      ...(spatial ? { zonePosition: (id: string) => spatial.getZone(id)?.position } : {}),
      ...(spatial?.nav?.hasVisibility ? { plantSpotAt: plantSpotRefOf(spatial), ...(plantTactics ? { pointSight: pointSightOf(spatial), plantTactics: true } : {}) } : {}),
    });
  }
  /** Set/clear the coach order for upcoming decisions (interactive-session timeouts). */
  setOrder(order: PolicyOrder | null): void {
    this.inner.setOrder(order);
  }
  /** Bind the real roster's decision profiles (keyed by this round's sim player ids). */
  setProfiles(profiles: ReadonlyMap<string, PlayerProfile> | null): void {
    this.inner.setProfiles(profiles);
  }
  /** Per-player "is this gear worth a save?" from the match economy (TeamDecisionPolicy.setSaveWorth). */
  setSaveWorth(worth: ReadonlyMap<string, boolean> | null): void {
    this.inner.setSaveWorth(worth);
  }
  /** The team's mid plan for the side this policy plays (TeamDecisionPolicy.setMidPlan; players as sim ids). */
  setMidPlan(plan: ResolvedMidSidePlan | null): void {
    this.inner.setMidPlan(plan);
  }
  /** The team's own estimate of mid control right now (null: not tracked). */
  midState(): MidControlState | null {
    return this.inner.midState();
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
  /** The team's post-plant (attack) and retake (defence) plans per site and plant spot (TeamDecisionPolicy.setSpotPlans). */
  setSpotPlans(plans: { readonly postPlant?: PostPlantPlans | null; readonly retake?: RetakePlans | null } | null): void {
    this.inner.setSpotPlans(plans);
  }
  /** Per-player information attributes + the match's call ledger (TeamDecisionPolicy.setInfoProfiles). */
  setInfoProfiles(profiles: ReadonlyMap<string, InfoProfile> | null, ledger?: CommsLedger): void {
    this.inner.setInfoProfiles(profiles, ledger);
  }
  /** The round's information trace (per-player knowledge, comms, minimap, trust). */
  informationTrace(): InformationTrace | null {
    return this.inner.informationTrace();
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
  spatial?: SpatialEngine,
  tactics?: MapTactics,
  plantTactics = false,
  midControl = false,
  information = false,
  ecoDefenseStack = false,
): Readonly<Record<Side, WrappedTeamPolicy>> {
  return { attack: new WrappedTeamPolicy(sq, abilityEffect, spatial, tactics, plantTactics, midControl, information, ecoDefenseStack), defense: new WrappedTeamPolicy(sq, abilityEffect, spatial, tactics, plantTactics, midControl, information, ecoDefenseStack) };
}

/** Cast the wrapped policies to the round-simulator's DecisionPolicy record (R2-B brand bridge). */
export function toSimPolicies(p: Readonly<Record<Side, WrappedTeamPolicy>>): Readonly<Record<Side, SimDecisionPolicy>> {
  return { attack: p.attack as unknown as SimDecisionPolicy, defense: p.defense as unknown as SimDecisionPolicy };
}
