/**
 * TeamDecisionPolicy — the DecisionPolicy the round-simulator drives (Handoff §17).
 *
 * Pipeline per decision: build the zone belief from the view's observation → generate
 * feasible candidates (Action Generator, from a team-only synthetic context) → IGL picks a
 * strategy and re-decides on new info → assign roles → each player picks a command biased
 * by role/strategy/profile → teamwork aligns timing. All randomness flows through the
 * supplied seeded RandomSource, so the same seed yields the same decision sequence.
 *
 * The SpatialQuery and (optional) EconomyEvaluator are CONSTRUCTION dependencies — the
 * per-decision input is only the PolicyView (no WorldState; DECISION-004).
 */
import type {
  ActionCommand,
  DecisionPolicy,
  EconomyEvaluator,
  PlayerProfile,
  PolicyDecision,
  PolicyView,
  RandomSource,
  RoleAssignment,
  SpatialQuery,
  TeamStrategy,
  ZoneId,
} from "@pv/shared-types";
import { buildTeamBelief, enemyPressureOnZone } from "@pv/decision-engine";
import { generateActions, type GenerationResult } from "@pv/action-generator";
import { synthContextFromView } from "./view.js";
import { assignRoles, profileFor, reconsider, selectStrategy } from "./igl.js";
import { choosePlayerCommand, type PlayerChoice } from "./player-policy.js";
import { applyTeamwork, type TeamworkEntry } from "./teamwork.js";

export interface TeamPolicyOptions {
  readonly profiles?: ReadonlyMap<string, PlayerProfile>;
  readonly economy?: EconomyEvaluator;
}

export interface TeamRoundTrace {
  readonly contextId: string;
  readonly scenarioRef: string | null;
  readonly teamId: string;
  readonly side: string;
  readonly openingStrategy: string;
  readonly finalStrategy: string;
  readonly reconsidered: boolean;
  readonly reconsiderReason: string;
  readonly roles: readonly RoleAssignment[];
  readonly players: ReadonlyArray<{
    readonly playerId: string;
    readonly role: string;
    readonly chosenActionId: string;
    readonly considered: ReadonlyArray<{ readonly id: string; readonly weight: number }>;
    readonly reason: string;
  }>;
  readonly generation: {
    readonly feasibleCount: number;
    readonly excludedCount: number;
    readonly selected: string | null;
  };
  readonly decision: PolicyDecision;
}

export class TeamDecisionPolicy implements DecisionPolicy {
  constructor(
    private readonly spatial: SpatialQuery,
    private readonly options: TeamPolicyOptions = {},
  ) {}

  /**
   * Ensure the spike carrier COMMITS to the objective (fixes the dominant timeExpired failure:
   * the stochastic per-player draw would re-pick peek/hold every 500ms and interrupt an
   * in-progress plant, so the plant never completed). When attacking and pre-plant, the carrier
   * deterministically (a) moves to the nearest plantable site, then (b) plants and keeps
   * planting while on the site. Skipped on a `save` strategy (eco rounds don't suicide-plant).
   * This only overrides the carrier's own command; everyone else's choice is untouched, and no
   * combat parameter is changed — it just stops the carrier abandoning the plant.
   */
  private commitSpikeCarrier(
    view: PolicyView,
    strategy: TeamStrategy,
    commands: readonly ActionCommand[],
  ): ActionCommand[] {
    const out = commands.slice();
    const holderId = view.spike.holderId;
    const phase = view.spike.phase;
    const canPlant = phase === "carried" || phase === "planting" || phase === "dropped";
    if (view.side !== "attack" || !holderId || !canPlant || strategy === "save") return out;

    const carrier = view.teammates.find((p) => String(p.id) === String(holderId) && p.alive);
    if (!carrier) return out;

    const carrierZone = this.spatial.nearestZone({ x: carrier.position.x, y: carrier.position.y });
    let command: ActionCommand;
    if (this.spatial.isPlantableZone(carrierZone)) {
      command = { playerId: carrier.id, kind: "plant", targetZone: carrierZone, executeAtMs: 0, sourceActionId: "carrier-commit:plant" };
    } else {
      const site = this.nearestPlantableSite(carrierZone);
      if (!site) return out; // no reachable plantable site — leave the carrier's drawn command
      command = { playerId: carrier.id, kind: "move", targetZone: site, moveMode: "run", executeAtMs: 0, sourceActionId: "carrier-commit:move" };
    }
    const idx = out.findIndex((c) => String(c.playerId) === String(holderId));
    if (idx >= 0) out[idx] = command;
    else out.push(command);
    return out;
  }

  /**
   * Symmetric to commitSpikeCarrier for the DEFENSE post-plant: without this, a defuse (7000ms
   * of continuous `defuse`) is interrupted every 500ms by the stochastic re-draw and never
   * completes, so defenders never retake and every plant detonates — making matches degenerate
   * (attack-sided, non-converging). The single alive defender nearest the plant commits to
   * retake: move (run) to the plant zone, then `defuse` and keep defusing while on it. Only the
   * chosen defender's command is overridden; no combat parameter is changed.
   */
  private commitDefuser(view: PolicyView, commands: readonly ActionCommand[]): ActionCommand[] {
    const out = commands.slice();
    const phase = view.spike.phase;
    if (view.side !== "defense" || (phase !== "planted" && phase !== "defusing")) return out;
    const pos = view.spike.position;
    if (!pos) return out;
    const plantZone = this.spatial.nearestZone({ x: pos.x, y: pos.y });

    const defenders = view.teammates.filter((p) => p.alive);
    let best: (typeof defenders)[number] | null = null;
    let bestMs = Infinity;
    for (const d of defenders) {
      const dz = this.spatial.nearestZone({ x: d.position.x, y: d.position.y });
      const t = dz === plantZone ? 0 : this.spatial.shortestTravelTimeMs(dz, plantZone, "run");
      if (t !== null && t < bestMs) {
        bestMs = t;
        best = d;
      }
    }
    if (!best) return out;

    const bz = this.spatial.nearestZone({ x: best.position.x, y: best.position.y });
    const command: ActionCommand = bz === plantZone
      ? { playerId: best.id, kind: "defuse", targetZone: plantZone, executeAtMs: 0, sourceActionId: "defuser-commit:defuse" }
      : { playerId: best.id, kind: "move", targetZone: plantZone, moveMode: "run", executeAtMs: 0, sourceActionId: "defuser-commit:move" };
    const idx = out.findIndex((c) => String(c.playerId) === String(best!.id));
    if (idx >= 0) out[idx] = command;
    else out.push(command);
    return out;
  }

  /** Nearest plantable site to a zone by run travel time (falls back to the first plantable site). */
  private nearestPlantableSite(from: ZoneId): ZoneId | null {
    const plantable = this.spatial.zonesByType("site").filter((z) => this.spatial.isPlantableZone(z));
    let best: ZoneId | null = null;
    let bestMs = Infinity;
    for (const z of plantable) {
      const t = this.spatial.shortestTravelTimeMs(from, z, "run");
      if (t !== null && t < bestMs) {
        bestMs = t;
        best = z;
      }
    }
    return best ?? plantable[0] ?? null;
  }

  private candidates(view: PolicyView): GenerationResult {
    const belief = buildTeamBelief(view.observation, this.spatial, {
      knownEnemyAliveCount: view.knownEnemyAliveCount,
    });
    const team = synthContextFromView(view);
    return generateActions({
      team,
      spatial: this.spatial,
      enemyPressure: (z) => enemyPressureOnZone(belief, z),
      ...(this.options.economy ? { economy: this.options.economy } : {}),
    });
  }

  decide(view: PolicyView, rng: RandomSource): PolicyDecision {
    return this.decideWithTrace(view, rng).decision;
  }

  decideWithTrace(view: PolicyView, rng: RandomSource): { decision: PolicyDecision; trace: TeamRoundTrace } {
    const generation = this.candidates(view);
    const opening = selectStrategy(view, this.spatial, rng);
    const recon = reconsider(view, this.spatial, opening, rng);
    const strategy = recon.strategy;
    const roles = assignRoles(view, strategy, this.options.profiles, rng);
    const roleOf = new Map(roles.map((r) => [String(r.playerId), r.role]));

    const alive = view.teammates.filter((p) => p.alive);
    const choices: Array<{ choice: PlayerChoice; entry: TeamworkEntry }> = [];
    for (const p of alive) {
      const role = roleOf.get(String(p.id)) ?? "support";
      const profile = profileFor(p.id, this.options.profiles);
      const choice = choosePlayerCommand(String(p.id), role, strategy, generation.feasible, profile, rng);
      choices.push({ choice, entry: { command: choice.command, role, profile } });
    }

    let commands = this.commitSpikeCarrier(view, strategy, applyTeamwork(choices.map((c) => c.entry)));
    commands = this.commitDefuser(view, commands);

    const decision: PolicyDecision = { strategy, roles, commands };
    const trace: TeamRoundTrace = {
      contextId: view.contextId,
      scenarioRef: view.scenarioRef,
      teamId: String(view.teamId),
      side: view.side,
      openingStrategy: opening,
      finalStrategy: strategy,
      reconsidered: recon.changed,
      reconsiderReason: recon.reason,
      roles,
      players: choices.map(({ choice }, i) => ({
        playerId: String(alive[i]!.id),
        role: roleOf.get(String(alive[i]!.id)) ?? "support",
        chosenActionId: choice.chosenActionId,
        considered: choice.considered,
        reason: choice.reason,
      })),
      generation: {
        feasibleCount: generation.feasible.length,
        excludedCount: generation.excluded.length,
        selected: generation.selected?.id ?? null,
      },
      decision,
    };
    return { decision, trace };
  }
}
