/**
 * Situation-aware action generation + constraint validation (TASK 007; README §15, §16).
 *
 * Candidates are GENERATED from the current state — alive players and their zones, the
 * spike state, reachable target zones and travel times (SpatialQuery), remaining time,
 * and ability/equipment — NOT selected from a fixed list (README §29). Four layers
 * (Handoff §13.2): Strategic (team goal) → Tactical (target zones/route) → Individual
 * (per-player action) → Parameters (concrete zone/route/ability). Constraint validation
 * EXCLUDES physically impossible actions with reasons (README §15.3), distinct from a low
 * utility.
 *
 * Out of scope here (left to P3 economy/ultimate engines): the economic VALUE of saving,
 * ultimate-point denial, and exit-kill trade value. Such actions are generated and
 * feasibility-checked, but their utility carries a rationale noting the valuation is
 * provisional. See Handoff §20.07–20.10.
 */
import { SPIKE_RULES } from "@pv/game-rules";
import type {
  CandidateAction,
  FeasibilityResult,
  InfeasibilityReason,
  PlayerState,
  SpatialQuery,
  TeamDecisionContext,
  ZoneId,
} from "@pv/shared-types";
import { economyOptionValue, pickEconomyOption, type EconomyContext } from "@pv/shared-types";

/** Map an economy option's combined round value ([-2,2]) to a base utility (~0..1.1). */
const economyBase = (combined: number): number => Math.max(0, Math.min(1.1, 0.5 + 0.25 * combined));
import {
  type ActionEvaluation,
  type EnemyPressureFn,
  type EvaluatedAction,
  type ExcludedAction,
  type GenerationResult,
  type GeneratorInput,
} from "./types.js";
import { estimateRisk, expectedUtility, zeroCost, WEIGHTS } from "./evaluate.js";

const PLANT_MS = SPIKE_RULES.plantDurationMs.value;
const DEFUSE_MS = SPIKE_RULES.defuseDurationMs.value;
const DEFAULT_INFO_MS = 5000;
const FAKE_SHOW_MS = 3000;

/** Provisional base objective values (heuristic; see evaluate.ts WEIGHTS note). */
const BASE = {
  execute: 1.0,
  plant: 1.1,
  postPlantHold: 0.9,
  retake: 0.85,
  defaultHold: 0.7,
  midControl: 0.55,
  fake: 0.6,
  aggroPush: 0.5,
  rotate: 0.5,
  exitKill: 0.5,
  default: 0.45,
  lurk: 0.4,
  save: 0.3,
  indivMove: 0.4,
  indivHold: 0.45,
  indivPeek: 0.35,
  indivAbility: 0.3,
  indivSave: 0.3,
} as const;

const feasible: FeasibilityResult = { feasible: true };
const infeasible = (reasons: InfeasibilityReason[]): FeasibilityResult => ({ feasible: false, reasons });

/** A candidate paired with the data needed to evaluate or explain it. */
interface Raw {
  candidate: CandidateAction;
  baseValue: number;
  riskZone: ZoneId | null;
  strategic: boolean;
  explanation: string;
  extraRationale: string[];
}

export function generateActions(input: GeneratorInput): GenerationResult {
  const { team, spatial } = input;
  const pressure: EnemyPressureFn = input.enemyPressure ?? (() => 0);
  const world = team.world;
  const phasePlanted = world.spike.phase === "planted";
  const alive = world.players.filter((p) => p.teamId === team.decidingTeamId && p.alive);
  const aliveSelf = alive.length;
  const aliveEnemy =
    team.knownEnemyAliveCount ?? team.observation.visibleEnemies.length;
  const economy = input.economy ?? null;
  const econCtx: EconomyContext = {
    roundNumber: world.roundNumber,
    side: team.decidingSide,
    aliveSelf,
    aliveEnemy,
    timeRemainingMs: world.timeRemainingMs,
    matchScore: world.matchScore ?? null,
    selfLoadoutValue: null,
  };

  const zoneOf = (p: PlayerState): ZoneId => spatial.nearestZone({ x: p.position.x, y: p.position.y });
  const sites = spatial.zonesByType("site");
  const mids = spatial.zonesByType("mid");
  const midZone = mids.find((z) => (spatial.getZoneMeta(z)?.callout ?? "").includes("courtyard")) ?? mids[0] ?? null;
  const carrier = world.spike.holderId
    ? alive.find((p) => p.id === world.spike.holderId) ?? null
    : null;

  const groupTravelMs = (actors: PlayerState[], target: ZoneId) => {
    let maxMs = 0;
    const unreachable: PlayerState[] = [];
    for (const p of actors) {
      const t = spatial.shortestTravelTimeMs(zoneOf(p), target, "run");
      if (t === null) unreachable.push(p);
      else maxMs = Math.max(maxMs, t);
    }
    return { ms: maxMs, reachableAll: unreachable.length === 0, unreachable };
  };

  const raws: Raw[] = [];
  const add = (r: Raw) => raws.push(r);

  const mkCandidate = (
    id: string,
    schemaId: string,
    category: CandidateAction["category"],
    actors: PlayerState[],
    parameters: Record<string, unknown>,
    requiredTimeMs: number,
    _abilities: number,
    feas: FeasibilityResult,
  ): CandidateAction => ({
    id,
    schemaId,
    category,
    actors: actors.map((p) => p.id),
    parameters,
    estimatedDurationMs: requiredTimeMs,
    creditCost: 0,
    feasibility: feas,
  });

  // ---------------- STRATEGIC + TACTICAL ----------------
  const timeRemaining = world.timeRemainingMs;

  if (team.decidingSide === "attack" && !phasePlanted) {
    // Executes (with plant objective) per site.
    for (const site of sites) {
      const letter = spatial.getZoneMeta(site)?.site ?? site;
      const actors = alive;
      const carrierReach = carrier ? spatial.shortestTravelTimeMs(zoneOf(carrier), site, "run") : null;
      const g = groupTravelMs(actors, site);
      // The plant is gated by the CARRIER reaching the site (support players converge in
      // parallel); requiredTime = carrier travel + plant.
      const requiredTime = (carrierReach ?? 0) + PLANT_MS;
      let feas: FeasibilityResult;
      let explanation = "";
      if (carrier === null || carrierReach === null) {
        feas = infeasible(["noPath"]);
        explanation = `spike carrier cannot reach ${letter} site`;
      } else if (requiredTime > timeRemaining) {
        feas = infeasible(["insufficientTime"]);
        explanation = `need ${requiredTime}ms (carrier move ${carrierReach}+plant ${PLANT_MS}) but only ${timeRemaining}ms left`;
      } else {
        feas = feasible;
      }
      add({
        candidate: mkCandidate(`${letter}_EXECUTE`, "strategic.execute", "strategic", actors,
          { targetSite: letter, targetZone: site, groupMoveMs: g.ms, includesPlant: true }, requiredTime, 0, feas),
        baseValue: BASE.execute, riskZone: site, strategic: true, explanation, extraRationale: [],
      });
    }
    // Mid control.
    if (midZone) {
      const g = groupTravelMs(alive, midZone);
      const feas = g.reachableAll && timeRemaining > g.ms ? feasible : infeasible(g.reachableAll ? ["insufficientTime"] : ["noPath"]);
      add({
        candidate: mkCandidate("MID_CONTROL", "strategic.midControl", "strategic", alive,
          { targetZone: midZone, groupMoveMs: g.ms }, g.ms, 0, feas),
        baseValue: BASE.midControl, riskZone: midZone, strategic: true,
        explanation: g.reachableAll ? "not enough time to contest mid" : "mid unreachable", extraRationale: [],
      });
    }
    // Default (gather info / spread).
    add({
      candidate: mkCandidate("DEFAULT", "strategic.default", "strategic", alive,
        { intent: "gatherInfo" }, DEFAULT_INFO_MS, 0, feasible),
      baseValue: BASE.default, riskZone: carrier ? zoneOf(carrier) : null, strategic: true, explanation: "", extraRationale: [],
    });
    // Fakes (need bodies).
    if (sites.length >= 2) {
      for (const fake of sites) {
        const real = sites.find((s) => s !== fake)!;
        const realLetter = spatial.getZoneMeta(real)?.site ?? real;
        const fakeLetter = spatial.getZoneMeta(fake)?.site ?? fake;
        const carrierToReal = carrier ? spatial.shortestTravelTimeMs(zoneOf(carrier), real, "run") : null;
        const requiredTime = (carrierToReal ?? 0) + FAKE_SHOW_MS + PLANT_MS;
        let feas: FeasibilityResult;
        let explanation = "";
        if (aliveSelf < 3) {
          feas = infeasible(["notEnoughPlayers"]);
          explanation = `fake needs ≥3 players, have ${aliveSelf}`;
        } else if (carrier === null || carrierToReal === null) {
          feas = infeasible(["noPath"]);
          explanation = `carrier cannot reach ${realLetter}`;
        } else if (requiredTime > timeRemaining) {
          feas = infeasible(["insufficientTime"]);
          explanation = `fake+rotate+plant needs ${requiredTime}ms > ${timeRemaining}ms`;
        } else feas = feasible;
        add({
          candidate: mkCandidate(`FAKE_${fakeLetter}_TO_${realLetter}`, "strategic.fake", "strategic", alive,
            { fakeSite: fakeLetter, realSite: realLetter, realZone: real }, requiredTime, 0, feas),
          baseValue: BASE.fake, riskZone: real, strategic: true, explanation, extraRationale: [],
        });
      }
    }
    // Lurk (one backline player).
    if (aliveSelf >= 2) {
      const lurker = alive[alive.length - 1]!;
      add({
        candidate: mkCandidate("LURK", "strategic.lurk", "strategic", [lurker],
          { player: lurker.id, zone: zoneOf(lurker) }, DEFAULT_INFO_MS, 0, feasible),
        baseValue: BASE.lurk, riskZone: zoneOf(lurker), strategic: true, explanation: "", extraRationale: [],
      });
    }
  }

  if (team.decidingSide === "attack" && phasePlanted) {
    const plantZone = world.spike.position
      ? spatial.nearestZone({ x: world.spike.position.x, y: world.spike.position.y })
      : sites[0] ?? null;
    add({
      candidate: mkCandidate("POST_PLANT_HOLD", "strategic.postPlantHold", "strategic", alive,
        { plantZone }, 2000, 0, feasible),
      baseValue: BASE.postPlantHold, riskZone: plantZone, strategic: true, explanation: "", extraRationale: [],
    });
    // Exit kill: chase an observed enemy (valuation is provisional — needs economy engine).
    for (const e of team.observation.visibleEnemies) {
      const ez = spatial.nearestZone({ x: e.lastSeenPosition.x, y: e.lastSeenPosition.y });
      const chaser = alive[0];
      if (!chaser) break;
      const t = spatial.shortestTravelTimeMs(zoneOf(chaser), ez, "run");
      const feas = t === null ? infeasible(["noPath"]) : feasible;
      add({
        candidate: mkCandidate(`EXIT_KILL_${e.playerId}`, "strategic.exitKill", "strategic", [chaser],
          { targetEnemy: e.playerId, targetZone: ez }, (t ?? 0) + 1000, 0, feas),
        baseValue: (() => {
          const opt = economy ? pickEconomyOption(economy.exitKillOptions(econCtx), /exit/i) : null;
          return opt ? economyBase(economyOptionValue(opt)) : BASE.exitKill;
        })(),
        riskZone: ez, strategic: true,
        explanation: t === null ? "cannot reach the saver" : "",
        extraRationale: [economy ? "exit-kill value from economy-engine (PV-2)" : "exit-kill value vs. keeping rifles delegated to economy-engine (PV-2) — provisional"],
      });
    }
  }

  if (team.decidingSide === "defense" && !phasePlanted) {
    add({
      candidate: mkCandidate("DEFAULT_HOLD", "strategic.defaultHold", "strategic", alive, {}, 1000, 0, feasible),
      baseValue: BASE.defaultHold, riskZone: alive[0] ? zoneOf(alive[0]) : null, strategic: true, explanation: "", extraRationale: [],
    });
    // Aggressive push toward a forward zone.
    const pushZone = sites[0] ?? midZone;
    if (pushZone) {
      const g = groupTravelMs(alive, pushZone);
      const feas = g.reachableAll ? feasible : infeasible(["noPath"]);
      add({
        candidate: mkCandidate("AGGRO_PUSH", "strategic.aggroPush", "strategic", alive,
          { targetZone: pushZone, groupMoveMs: g.ms }, g.ms, 0, feas),
        baseValue: BASE.aggroPush, riskZone: pushZone, strategic: true, explanation: g.reachableAll ? "" : "push target unreachable", extraRationale: [],
      });
    }
    // Rotations to each site.
    for (const site of sites) {
      const letter = spatial.getZoneMeta(site)?.site ?? site;
      const g = groupTravelMs(alive, site);
      const feas = g.reachableAll ? feasible : infeasible(["noPath"]);
      add({
        candidate: mkCandidate(`ROTATE_${letter}`, "strategic.rotate", "strategic", alive,
          { targetSite: letter, targetZone: site, groupMoveMs: g.ms }, g.ms, 0, feas),
        baseValue: BASE.rotate, riskZone: site, strategic: true, explanation: g.reachableAll ? "" : `${letter} unreachable`, extraRationale: [],
      });
    }
  }

  if (team.decidingSide === "defense" && phasePlanted) {
    const plantZone = world.spike.position
      ? spatial.nearestZone({ x: world.spike.position.x, y: world.spike.position.y })
      : sites[0] ?? null;
    const detonation = world.spike.detonationInMs ?? timeRemaining;
    if (plantZone) {
      const g = groupTravelMs(alive, plantZone);
      const requiredTime = g.ms + DEFUSE_MS;
      let feas: FeasibilityResult;
      let explanation = "";
      if (!g.reachableAll) {
        feas = infeasible(["noPath"]);
        explanation = "retake path blocked";
      } else if (requiredTime > detonation) {
        feas = infeasible(["insufficientTime"]);
        explanation = `retake+defuse needs ${requiredTime}ms but ${detonation}ms to detonation`;
      } else feas = feasible;
      add({
        candidate: mkCandidate("RETAKE", "strategic.retake", "strategic", alive,
          { plantZone, groupMoveMs: g.ms, includesDefuse: true }, requiredTime, 0, feas),
        baseValue: BASE.retake, riskZone: plantZone, strategic: true, explanation, extraRationale: [],
      });
    }
  }

  // SAVE is always a strategic option. Its VALUE is the economy engine's job (PV-2); if no
  // EconomyEvaluator is supplied we use a provisional heuristic and say so.
  {
    const disadvantaged = aliveEnemy > aliveSelf;
    const saveBonus = disadvantaged ? WEIGHTS.disadvantageRisk * (aliveEnemy - aliveSelf) : 0;
    const saveOpt = economy ? pickEconomyOption(economy.saveOptions(econCtx), /save/i) : null;
    const baseValue = saveOpt ? economyBase(economyOptionValue(saveOpt)) : BASE.save + saveBonus;
    const rationale = saveOpt
      ? [`save value from economy-engine (PV-2): ${saveOpt.explanation}`, `ultDelta ${saveOpt.ultDelta}`]
      : ["save value (equipment/next-round/ult denial) delegated to economy-engine (PV-2) — provisional heuristic"];
    add({
      candidate: mkCandidate("SAVE", "strategic.save", "strategic", alive, { reason: "preserve equipment" }, 2000, 0, feasible),
      baseValue, riskZone: null, strategic: true, explanation: "", extraRationale: rationale,
    });
  }

  // ---------------- INDIVIDUAL ----------------
  const primaryObjectiveZone: ZoneId | null = (() => {
    if (phasePlanted && world.spike.position) {
      return spatial.nearestZone({ x: world.spike.position.x, y: world.spike.position.y });
    }
    if (carrier) {
      // nearest site to the carrier
      let best: ZoneId | null = null;
      let bestMs = Infinity;
      for (const s of sites) {
        const t = spatial.shortestTravelTimeMs(zoneOf(carrier), s, "run");
        if (t !== null && t < bestMs) {
          bestMs = t;
          best = s;
        }
      }
      return best;
    }
    return sites[0] ?? null;
  })();

  for (const p of alive) {
    const cz = zoneOf(p);
    // Hold.
    add({
      candidate: mkCandidate(`HOLD@${p.id}`, "individual.hold", "individual", [p], { zone: cz }, 0, 0, feasible),
      baseValue: BASE.indivHold, riskZone: cz, strategic: false, explanation: "", extraRationale: [],
    });
    // Move to objective.
    if (primaryObjectiveZone && primaryObjectiveZone !== cz) {
      const t = spatial.shortestTravelTimeMs(cz, primaryObjectiveZone, "run");
      const feas = t === null ? infeasible(["noPath"]) : feasible;
      add({
        candidate: mkCandidate(`MOVE@${p.id}`, "individual.move", "individual", [p],
          { from: cz, to: primaryObjectiveZone }, t ?? 0, 0, feas),
        baseValue: BASE.indivMove, riskZone: primaryObjectiveZone, strategic: false,
        explanation: t === null ? "no path to objective" : "", extraRationale: [],
      });
    }
    // Peek toward the highest-pressure visible zone.
    const visible = spatial.visibleZonesFrom(cz);
    let peekZone: ZoneId | null = null;
    let peekP = 0;
    for (const z of visible) {
      const pr = pressure(z);
      if (pr >= peekP) {
        peekP = pr;
        peekZone = z;
      }
    }
    if (peekZone) {
      add({
        candidate: mkCandidate(`PEEK@${p.id}`, "individual.peek", "individual", [p], { from: cz, at: peekZone }, 800, 0, feasible),
        baseValue: BASE.indivPeek, riskZone: peekZone, strategic: false, explanation: "", extraRationale: [],
      });
    }
    // Use ability (per basic charge).
    for (const ab of p.abilities.basic) {
      const feas = ab.charges > 0 ? feasible : infeasible(["missingAbility"]);
      add({
        candidate: mkCandidate(`ABILITY:${ab.abilityId}@${p.id}`, "individual.useAbility", "individual", [p],
          { abilityId: ab.abilityId, charges: ab.charges }, 600, ab.charges > 0 ? 1 : 0, feas),
        baseValue: BASE.indivAbility, riskZone: cz, strategic: false,
        explanation: ab.charges > 0 ? "" : `no charges of ${ab.abilityId}`, extraRationale: [],
      });
    }
    // Plant (carrier only, pre-plant).
    if (!phasePlanted && carrier && p.id === carrier.id) {
      const plantable = spatial.isPlantableZone(cz);
      const requiredTime = PLANT_MS;
      let feas: FeasibilityResult;
      let explanation = "";
      if (!plantable) {
        feas = infeasible(["blocked"]);
        explanation = `${cz} is not a plantable zone`;
      } else if (requiredTime > timeRemaining) {
        feas = infeasible(["insufficientTime"]);
        explanation = `plant needs ${PLANT_MS}ms but ${timeRemaining}ms left`;
      } else feas = feasible;
      add({
        candidate: mkCandidate(`PLANT@${p.id}`, "individual.plant", "individual", [p], { zone: cz }, requiredTime, 0, feas),
        baseValue: BASE.plant, riskZone: cz, strategic: false, explanation, extraRationale: [],
      });
    }
    // Defuse (defender, post-plant, on the plant zone).
    if (phasePlanted && team.decidingSide === "defense") {
      const plantZone = world.spike.position ? spatial.nearestZone({ x: world.spike.position.x, y: world.spike.position.y }) : null;
      const detonation = world.spike.detonationInMs ?? timeRemaining;
      if (plantZone) {
        let feas: FeasibilityResult;
        let explanation = "";
        if (cz !== plantZone) {
          feas = infeasible(["outOfRange"]);
          explanation = `not on the plant zone (${cz} ≠ ${plantZone})`;
        } else if (DEFUSE_MS > detonation) {
          feas = infeasible(["insufficientTime"]);
          explanation = `defuse needs ${DEFUSE_MS}ms but ${detonation}ms to detonation`;
        } else feas = feasible;
        add({
          candidate: mkCandidate(`DEFUSE@${p.id}`, "individual.defuse", "individual", [p], { zone: plantZone }, DEFUSE_MS, 0, feas),
          baseValue: BASE.indivSave, riskZone: plantZone, strategic: false, explanation, extraRationale: [],
        });
      }
    }
    // Save / retreat (always available).
    add({
      candidate: mkCandidate(`SAVE_RETREAT@${p.id}`, "individual.save", "individual", [p], { zone: cz }, 1500, 0, feasible),
      baseValue: BASE.indivSave, riskZone: null, strategic: false, explanation: "",
      extraRationale: ["retreat/keep-weapon valuation needs the economy engine (P3) — provisional"],
    });
  }

  // ---------------- FINALIZE: evaluate feasible, collect excluded ----------------
  const feasibleActions: EvaluatedAction[] = [];
  const excluded: ExcludedAction[] = [];

  for (const r of raws) {
    if (!r.candidate.feasibility.feasible) {
      excluded.push({
        candidate: r.candidate,
        reasons: r.candidate.feasibility.reasons,
        explanation: r.explanation || r.candidate.feasibility.reasons.join(", "),
      });
      continue;
    }
    // Zone-targeted actions carry positional risk; retreat/save actions (no target zone)
    // are deliberately low-risk — the point of saving is to avoid the engagement.
    const risk = r.riskZone
      ? estimateRisk(r.riskZone, spatial, pressure, aliveSelf, aliveEnemy)
      : 0.1;
    const requiredTimeMs = r.candidate.estimatedDurationMs;
    const util = expectedUtility(r.baseValue, risk, requiredTimeMs, timeRemaining);
    const rationale: string[] = [
      `base ${r.baseValue.toFixed(2)}`,
      `risk ${risk.toFixed(2)}`,
      `time ${requiredTimeMs}ms/${timeRemaining}ms`,
      ...r.extraRationale,
    ];
    const resourceCost = r.candidate.schemaId === "individual.useAbility"
      ? { credits: 0, abilities: 1 }
      : zeroCost;
    const evaluation: ActionEvaluation = {
      requiredTimeMs,
      resourceCost,
      estimatedRisk: risk,
      expectedUtility: Number(util.toFixed(4)),
      rationale,
    };
    feasibleActions.push({ ...r.candidate, evaluation });
  }

  // Deterministic ordering: utility desc, then id asc.
  feasibleActions.sort((a, b) =>
    b.evaluation.expectedUtility - a.evaluation.expectedUtility || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const bestStrategic = feasibleActions.find((a) => a.category === "strategic") ?? null;
  const selected = bestStrategic ?? feasibleActions[0] ?? null;
  const selectionRationale = selected
    ? `highest-utility feasible ${selected.category} action "${selected.id}" ` +
      `(utility ${selected.evaluation.expectedUtility}, risk ${selected.evaluation.estimatedRisk.toFixed(2)})`
    : "no feasible action";

  return {
    contextId: team.contextId,
    scenarioRef: team.scenarioRef,
    decidingTeamId: team.decidingTeamId,
    atMs: world.timeRemainingMs,
    feasible: feasibleActions,
    excluded,
    selected,
    selectionRationale,
  };
}
