import type {
  Combatant,
  CombatEvent,
  CombatantOutcome,
  Duel,
  DuelResult,
  HitLocation,
  PlayerId,
} from "./types.js";
import { DEFAULT_PARAMS, type CombatCalibration, type CombatParams } from "./params.js";
import { mulberry32, deriveSeed, type Rng } from "./rng.js";
import { applyDamage, damageForRange } from "./damage.js";
import { headshotChance, hitChance, readyDelayMs } from "./skills.js";

interface FighterState {
  readonly c: Combatant;
  health: number;
  armor: number;
  ammo: number;
  nextFireAt: number;
  shotsFired: number;
  shotsHit: number;
  rng: Rng;
  reloading: boolean;
}

export interface ResolveOptions {
  readonly params?: CombatParams;
  readonly calibration?: CombatCalibration;
}

function initState(c: Combatant, seed: number, p: CombatParams, cal: CombatCalibration): FighterState {
  return {
    c,
    health: c.health,
    armor: c.armor,
    ammo: c.ammo ?? c.weapon.magazineSize,
    nextFireAt: readyDelayMs(c, p, cal),
    shotsFired: 0,
    shotsHit: 0,
    rng: mulberry32(deriveSeed(seed, c.id)),
    reloading: false,
  };
}

function rollLocation(rng: Rng, hsChance: number): HitLocation {
  if (rng() < hsChance) return "head";
  if (rng() < 0.15) return "leg";
  return "body";
}

/**
 * Resolve a 1v1 duel deterministically as a timeline of shots. Neither winner nor TTK is
 * decided up front (DECISION-002): events are produced from reaction timing, fire rate,
 * per-shot hit/location rolls (seeded), damage falloff and armor. Same seed + same input
 * ⇒ identical event log (DECISION-010).
 */
export function resolveDuel(duel: Duel, seed: number, opts: ResolveOptions = {}): DuelResult {
  const p = opts.params ?? DEFAULT_PARAMS;
  const cal = opts.calibration ?? {};
  const states: Record<PlayerId, FighterState> = {
    [duel.a.id]: initState(duel.a, seed, p, cal),
    [duel.b.id]: initState(duel.b, seed, p, cal),
  };
  const order: [FighterState, FighterState] = [states[duel.a.id], states[duel.b.id]];
  const opponentOf = (s: FighterState): FighterState => (s === order[0] ? order[1] : order[0]);

  const events: CombatEvent[] = [];
  let winner: PlayerId | null = null;
  let loser: PlayerId | null = null;
  let ttk: number | null = null;

  const bothAlive = () => order[0].health > 0 && order[1].health > 0;

  while (bothAlive()) {
    // pick the next shooter: earliest nextFireAt; ties → combatant a (order[0]) first.
    const shooter = order[0].nextFireAt <= order[1].nextFireAt ? order[0] : order[1];
    const t = shooter.nextFireAt;
    if (t > p.timeBudgetMs) break;

    if (shooter.ammo <= 0) {
      events.push({ kind: "reloadStart", timeMs: t, actor: shooter.c.id });
      shooter.nextFireAt = t + shooter.c.weapon.reloadTimeMs;
      shooter.ammo = shooter.c.weapon.magazineSize;
      events.push({ kind: "reloadEnd", timeMs: shooter.nextFireAt, actor: shooter.c.id });
      continue;
    }

    const target = opponentOf(shooter);
    shooter.shotsFired += 1;
    shooter.ammo -= 1;
    events.push({ kind: "shot", timeMs: t, actor: shooter.c.id, target: target.c.id });

    const isFirst = shooter.shotsFired === 1;
    const pHit = hitChance(shooter.c, target.c, duel.distanceMeters, isFirst, p, cal, t);
    if (shooter.rng() < pHit) {
      const loc = rollLocation(shooter.rng, headshotChance(shooter.c, p, cal, t));
      const dmg = damageForRange(shooter.c.weapon, duel.distanceMeters, loc);
      const after = applyDamage({ health: target.health, armor: target.armor }, dmg);
      target.health = after.health;
      target.armor = after.armor;
      shooter.shotsHit += 1;
      events.push({ kind: "hit", timeMs: t, actor: shooter.c.id, target: target.c.id, location: loc });
      events.push({
        kind: "damage",
        timeMs: t,
        actor: shooter.c.id,
        target: target.c.id,
        location: loc,
        amount: dmg,
        targetHealthAfter: after.health,
        targetArmorAfter: after.armor,
      });
      if (target.health <= 0) {
        events.push({ kind: "kill", timeMs: t, actor: shooter.c.id, target: target.c.id });
        winner = shooter.c.id;
        loser = target.c.id;
        ttk = t;
        break;
      }
    }

    shooter.nextFireAt = t + 1000 / shooter.c.weapon.fireRate;
  }

  const outcomes: Record<PlayerId, CombatantOutcome> = {};
  for (const s of order) {
    outcomes[s.c.id] = {
      id: s.c.id,
      alive: s.health > 0,
      health: s.health,
      armor: s.armor,
      ammo: s.ammo,
      shotsFired: s.shotsFired,
      shotsHit: s.shotsHit,
    };
  }
  return { winner, loser, timeToKillMs: ttk, events, outcomes };
}
