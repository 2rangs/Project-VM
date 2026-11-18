import type { SpatialEngine } from "@project-v/spatial-engine";
import type {
  AbilityEvent,
  AbilitySpec,
  AbilityUsage,
  ActiveEffect,
  RevealSnapshot,
  Vec3,
} from "./types.js";

/** Enemy position snapshot the caller resolves (in-radius enemies) for recon/trap reveals. */
export interface SnapshotEnemy {
  readonly enemyId: string;
  readonly teamId: string;
  readonly position: Vec3;
}

export interface UseOptions {
  /** Players caught by a flash/concuss (caller resolves LoS/range via perception). */
  readonly affectedPlayerIds?: readonly string[];
  /** Enemies within a recon radius at trigger time — frozen into the reveal snapshot. */
  readonly snapshotEnemies?: readonly SnapshotEnemy[];
}

/**
 * Ability-engine (v0). Deploys abilities as live effect objects on an increasing
 * millisecond clock (`startedAtMs` / `nowMs`), and exposes adapters that feed the
 * spatial (LoS/path), perception (smoke/reveal) and combat (flash) engines.
 *
 * Effects start, expire and can be destroyed; every transition is an AbilityEvent.
 */
export class AbilityEngine {
  private readonly effects = new Map<string, ActiveEffect>();
  private readonly blinds = new Map<string, number>(); // playerId -> blind expiry (ms)
  private readonly log: AbilityEvent[] = [];

  constructor(private readonly spatial: SpatialEngine) {}

  get events(): readonly AbilityEvent[] {
    return this.log;
  }

  private emit(e: AbilityEvent): void {
    this.log.push(e);
  }

  /** Deploy an ability instance. Returns the created effect. */
  use(spec: AbilitySpec, usage: AbilityUsage, opts: UseOptions = {}): ActiveEffect {
    const zoneId = this.spatial.nearestZone(usage.origin).id;
    const expiresAtMs = spec.durationMs != null ? usage.startedAtMs + spec.durationMs : null;
    const flashDurationMs = spec.flashDurationMs ?? 0;

    const reveals: RevealSnapshot[] = (opts.snapshotEnemies ?? []).map((e) => ({
      enemyId: e.enemyId,
      teamId: e.teamId,
      position: { ...e.position }, // frozen copy — never updated afterwards
      revealedAtMs: usage.startedAtMs,
      byAbilityId: spec.abilityId,
    }));

    const effect: ActiveEffect = {
      instanceId: usage.instanceId,
      abilityId: spec.abilityId,
      effectType: spec.effectType,
      ownerId: usage.ownerId,
      teamId: usage.teamId,
      origin: { ...usage.origin },
      zoneId,
      startedAtMs: usage.startedAtMs,
      expiresAtMs,
      radiusUnits: spec.radiusUnits ?? 0,
      hp: spec.wallHp ?? null,
      destroyed: false,
      flashDurationMs,
      reveals,
    };
    this.effects.set(effect.instanceId, effect);
    this.emit({ kind: "effectStart", timeMs: usage.startedAtMs, instanceId: effect.instanceId, abilityId: spec.abilityId, effectType: spec.effectType });

    for (const pid of opts.affectedPlayerIds ?? []) {
      if (flashDurationMs > 0) {
        this.blinds.set(pid, Math.max(this.blinds.get(pid) ?? 0, usage.startedAtMs + flashDurationMs));
        this.emit({ kind: "flashApplied", timeMs: usage.startedAtMs, instanceId: effect.instanceId, abilityId: spec.abilityId, effectType: spec.effectType, targetId: pid });
      }
    }
    for (const r of reveals) {
      this.emit({ kind: "reveal", timeMs: usage.startedAtMs, instanceId: effect.instanceId, abilityId: spec.abilityId, effectType: spec.effectType, targetId: r.enemyId });
    }
    return effect;
  }

  /** Advance the clock: expire timed effects and clear elapsed blinds. */
  advance(nowMs: number): void {
    for (const [id, e] of this.effects) {
      if (e.destroyed) continue;
      if (e.expiresAtMs != null && nowMs >= e.expiresAtMs) {
        this.effects.delete(id);
        this.emit({ kind: "effectExpire", timeMs: e.expiresAtMs, instanceId: id, abilityId: e.abilityId, effectType: e.effectType });
      }
    }
    for (const [pid, exp] of this.blinds) {
      if (nowMs >= exp) this.blinds.delete(pid);
    }
  }

  /** Damage a destructible wall. Returns true if it was destroyed by this hit. */
  damageWall(instanceId: string, amount: number, nowMs: number): boolean {
    const e = this.effects.get(instanceId);
    if (!e || e.hp == null || e.destroyed) return false;
    e.hp -= amount;
    if (e.hp <= 0) {
      e.hp = 0;
      e.destroyed = true;
      this.effects.delete(instanceId);
      this.emit({ kind: "effectDestroyed", timeMs: nowMs, instanceId, abilityId: e.abilityId, effectType: e.effectType });
      return true;
    }
    return false;
  }

  /** Trigger a trap/tripwire: records a reveal snapshot of nearby enemies. */
  triggerTrap(instanceId: string, snapshotEnemies: readonly SnapshotEnemy[], nowMs: number): void {
    const e = this.effects.get(instanceId);
    if (!e) return;
    const reveals = snapshotEnemies.map((s) => ({
      enemyId: s.enemyId,
      teamId: s.teamId,
      position: { ...s.position },
      revealedAtMs: nowMs,
      byAbilityId: e.abilityId,
    }));
    (e.reveals as RevealSnapshot[]).push(...reveals);
    this.emit({ kind: "trapTriggered", timeMs: nowMs, instanceId, abilityId: e.abilityId, effectType: e.effectType });
    for (const r of reveals) {
      this.emit({ kind: "reveal", timeMs: nowMs, instanceId, abilityId: e.abilityId, effectType: e.effectType, targetId: r.enemyId });
    }
  }

  // ---- state access ----

  activeEffects(): ActiveEffect[] {
    return [...this.effects.values()];
  }

  effectsOfType(type: ActiveEffect["effectType"]): ActiveEffect[] {
    return this.activeEffects().filter((e) => e.effectType === type);
  }

  getEffect(instanceId: string): ActiveEffect | undefined {
    return this.effects.get(instanceId);
  }

  /** Remaining blind duration (ms) for a player — feeds combat posture.flashBlindMs. */
  blindRemainingMs(playerId: string, nowMs: number): number {
    const exp = this.blinds.get(playerId);
    return exp != null && exp > nowMs ? exp - nowMs : 0;
  }
}
