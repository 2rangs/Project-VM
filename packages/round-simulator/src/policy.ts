import type { ActionCommand, DecisionContext, DecisionPolicy } from "./types.js";

/**
 * A SIMPLE, SCRIPTED stand-in policy — NOT the final AI. It exists only to drive the
 * round loop deterministically for testing. PV-3's Decision Engine will replace it via
 * the same DecisionPolicy interface. It reads ONLY the DecisionContext (observation +
 * public round facts), never the world (DECISION-004).
 *
 * Attack: push the assigned site; plant when the carrier reaches a plantable zone.
 * Defense: hold an assigned anchor; rotate toward a zone where an enemy was seen/heard.
 */
export interface ScriptedPolicyOptions {
  /** Attack: the site zone to execute onto (e.g. "a-site"). */
  readonly attackSite?: string;
  /** Defense: anchor zone per player id; falls back to holding the current zone. */
  readonly defenseAnchors?: Readonly<Record<string, string>>;
}

export class ScriptedPolicy implements DecisionPolicy {
  constructor(private readonly opts: ScriptedPolicyOptions = {}) {}

  decide(ctx: DecisionContext): ActionCommand {
    return ctx.side === "attack" ? this.attack(ctx) : this.defense(ctx);
  }

  private attack(ctx: DecisionContext): ActionCommand {
    const site = this.opts.attackSite ?? "a-site";
    // carrier plants on the site, and KEEPS planting through the planting phase
    // (the phase flips carried→planting, so we must keep committing or it resets).
    if (ctx.hasSpike && ctx.selfZoneId === site && (ctx.round.spikePhase === "carried" || ctx.round.spikePhase === "planting")) {
      return { kind: "plant" };
    }
    if (ctx.selfZoneId !== site) {
      return { kind: "move", targetZone: site, mode: "run" };
    }
    return { kind: "hold" };
  }

  private defense(ctx: DecisionContext): ActionCommand {
    // retake: if the spike is planted, defuse when standing on it, else rotate to it.
    if (ctx.round.spikeZoneId) {
      if (ctx.selfZoneId === ctx.round.spikeZoneId) return { kind: "defuse" };
      return { kind: "move", targetZone: ctx.round.spikeZoneId, mode: "run" };
    }
    // hold the angle and fight when an enemy is in sight
    if (ctx.observation.visibleEnemies.some((e) => e.currentlyVisible)) {
      return { kind: "hold" };
    }
    const anchor = this.opts.defenseAnchors?.[ctx.selfId];
    if (anchor && ctx.selfZoneId !== anchor) {
      return { kind: "move", targetZone: anchor, mode: "walk" };
    }
    return { kind: "hold" };
  }
}
