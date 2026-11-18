import type {
  ActionCommand,
  DecisionPolicy,
  PolicyDecision,
  PolicyView,
  RandomSource,
  RoleAssignment,
  SpatialQuery,
  TeamStrategy,
} from "./policy-contract.js";

export interface ScriptedPolicyOptions {
  /** Attack: the site zone to execute onto (e.g. "a-site"). */
  readonly attackSite?: string;
  /** Defense: anchor zone per player id; falls back to holding the current zone. */
  readonly defenseAnchors?: Readonly<Record<string, string>>;
  /** Deploy utility (smoke/flash/recon/molly) while executing. Opt-in. */
  readonly useUtility?: boolean;
}

/**
 * A SIMPLE, SCRIPTED **team** policy implementing PV-3's DecisionPolicy contract — NOT the
 * final AI. It drives the round loop deterministically for testing; PV-3's TeamDecisionPolicy
 * replaces it via the same interface. Input is the observable {@link PolicyView} only (no
 * WorldState, DECISION-004). The map is a construction dependency (SpatialQuery), used to map
 * each teammate's position to a zone.
 *
 * Attack: push the assigned site; the spike carrier plants once on it. Defense: hold an
 * anchor, rotate to retake/defuse when the spike is planted.
 */
export class ScriptedPolicy implements DecisionPolicy {
  constructor(private readonly spatial: SpatialQuery, private readonly opts: ScriptedPolicyOptions = {}) {}

  decide(view: PolicyView, _rng: RandomSource): PolicyDecision {
    return view.side === "attack" ? this.attack(view) : this.defense(view);
  }

  private zoneOf(position: { x: number; y: number }): string {
    return this.spatial.nearestZone(position);
  }

  private attack(view: PolicyView): PolicyDecision {
    const site = this.opts.attackSite ?? "a-site";
    const carrierId = view.spike.holderId;
    const planting = view.spike.phase === "carried" || view.spike.phase === "planting";
    // dropped spike (carrier died): send the lowest-id alive attacker to retrieve it.
    const dropped = carrierId == null && view.spike.position != null && view.spike.phase === "carried";
    const dropZone = dropped ? this.zoneOf(view.spike.position!) : null;
    const retriever = dropped
      ? view.teammates.filter((p) => p.alive && p.side === "attack").map((p) => p.id).sort()[0]
      : null;
    const commands: ActionCommand[] = [];
    const roles: RoleAssignment[] = [];
    let idx = 0;
    for (const p of view.teammates) {
      if (!p.alive) continue;
      roles.push({ playerId: p.id, role: idx++ === 0 ? "entry" : "support" });
      const zone = this.zoneOf(p.position);
      if (p.id === retriever && dropZone && zone !== dropZone) {
        commands.push({ playerId: p.id, kind: "move", targetZone: dropZone, moveMode: "run" });
        continue;
      }
      // deploy utility mid-execute (once, while approaching but not yet on site).
      // abilities is PV-3's AbilityInventory (R2-B): pick a basic/signature slot with charges.
      if (this.opts.useUtility && zone !== site) {
        const pool = [...p.abilities.basic, ...(p.abilities.signature ? [p.abilities.signature] : [])];
        const ready = pool.find((a) => a.charges > 0);
        if (ready && p.id !== carrierId) {
          commands.push({ playerId: p.id, kind: "useAbility", abilityId: ready.abilityId });
          continue;
        }
      }
      if (p.id === carrierId && zone === site && planting) {
        commands.push({ playerId: p.id, kind: "plant", targetZone: site });
      } else if (zone !== site) {
        commands.push({ playerId: p.id, kind: "move", targetZone: site, moveMode: "run" });
      } else {
        commands.push({ playerId: p.id, kind: "hold" });
      }
    }
    const strategy: TeamStrategy = site === "b-site" ? "bExecute" : "aExecute";
    return { strategy, roles, commands };
  }

  private defense(view: PolicyView): PolicyDecision {
    const planted = (view.spike.phase === "planted" || view.spike.phase === "defusing") && view.spike.position != null;
    const commands: ActionCommand[] = [];
    const roles: RoleAssignment[] = [];
    const seesEnemy = view.observation.visibleEnemies.some((e) => e.currentlyVisible);

    if (planted) {
      const spikeZone = this.zoneOf(view.spike.position!);
      // Retake: rotate onto the spike, but DEFUSE ONLY WHEN CLEAR. A defender on the spike with
      // an attacker visible ON THE SITE should hold the angle and win the fight first, not start
      // a defuse a held site would interrupt (suicide-defuse, which inflates the defuse rate).
      const attackerOnSite = view.observation.visibleEnemies.some((e) => e.currentlyVisible && this.zoneOf(e.lastSeenPosition) === spikeZone);
      for (const p of view.teammates) {
        if (!p.alive) continue;
        roles.push({ playerId: p.id, role: "rotator" });
        const zone = this.zoneOf(p.position);
        if (zone !== spikeZone) {
          commands.push({ playerId: p.id, kind: "move", targetZone: spikeZone, moveMode: "run" });
        } else if (attackerOnSite) {
          commands.push({ playerId: p.id, kind: "hold" }); // clear the site before defusing
        } else {
          commands.push({ playerId: p.id, kind: "defuse", targetZone: spikeZone });
        }
      }
      return { strategy: "retake", roles, commands };
    }

    for (const p of view.teammates) {
      if (!p.alive) continue;
      roles.push({ playerId: p.id, role: "anchor" });
      const zone = this.zoneOf(p.position);
      const anchor = this.opts.defenseAnchors?.[p.id];
      if (seesEnemy) {
        commands.push({ playerId: p.id, kind: "hold" });
      } else if (anchor && zone !== anchor) {
        commands.push({ playerId: p.id, kind: "move", targetZone: anchor, moveMode: "walk" });
      } else {
        commands.push({ playerId: p.id, kind: "hold" });
      }
    }
    return { strategy: "defaultHold", roles, commands };
  }
}
