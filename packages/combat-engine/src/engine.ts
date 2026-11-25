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
import { headshotChance, hitChance, keepsMovingAgainst, pelletLandChance, readyDelayMs } from "./skills.js";

interface FighterState {
  readonly c: Combatant;
  /** The fire mode of this duel: pellets per pull, their spread, pulls per second, rounds per pull. */
  readonly mode: { readonly pellets: number; readonly spreadDeg: number; readonly fireRate: number; readonly ammoPerShot: number };
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

function initState(c: Combatant, opponent: Combatant, seed: number, p: CombatParams, cal: CombatCalibration, distanceMeters: number): FighterState {
  const w = c.weapon;
  const alt = w.altFire && distanceMeters <= w.altFire.useWithinMeters ? w.altFire : null;
  const mode = alt
    ? { pellets: alt.pellets, spreadDeg: alt.spreadDeg, fireRate: alt.fireRate, ammoPerShot: alt.ammoPerShot }
    : { pellets: w.pellets ?? 1, spreadDeg: w.spreadDeg ?? 0, fireRate: w.fireRate, ammoPerShot: 1 };
  return {
    c,
    mode,
    health: c.health,
    armor: c.armor,
    ammo: c.ammo ?? c.weapon.magazineSize,
    // The line of sight between them turns at (own lateral + opponent lateral) / distance for BOTH
    // fighters: a strafing peeker's crosshair drifts off a still holder as much as the holder's
    // crosshair drifts off it.
    nextFireAt: readyDelayMs(c, p, cal, distanceMeters, (c.posture.lateralSpeedMps ?? 0) + (opponent.posture.lateralSpeedMps ?? 0)),
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
  // A run-and-gun shooter that would rather stay a moving target fights on the move.
  const a = keepsMovingAgainst(duel.a, duel.b) ? { ...duel.a, posture: { ...duel.a.posture, keepsMoving: true } } : duel.a;
  const b = keepsMovingAgainst(duel.b, duel.a) ? { ...duel.b, posture: { ...duel.b.posture, keepsMoving: true } } : duel.b;
  const states: Record<PlayerId, FighterState> = {
    [duel.a.id]: initState(a, b, seed, p, cal, duel.distanceMeters),
    [duel.b.id]: initState(b, a, seed, p, cal, duel.distanceMeters),
  };
  const order: [FighterState, FighterState] = [states[duel.a.id], states[duel.b.id]];
  const opponentOf = (s: FighterState): FighterState => (s === order[0] ? order[1] : order[0]);

  const events: CombatEvent[] = [];
  let winner: PlayerId | null = null;
  let loser: PlayerId | null = null;
  let ttk: number | null = null;
  let disengagedAtMs: number | undefined;
  // A jiggle / shoulder peek: the line of sight ends when the first fighter is back behind cover.
  const exposedUntil = Math.min(duel.a.posture.exposedUntilMs ?? Infinity, duel.b.posture.exposedUntilMs ?? Infinity);

  const bothAlive = () => order[0].health > 0 && order[1].health > 0;

  while (bothAlive()) {
    // pick the next shooter: earliest nextFireAt; ties → combatant a (order[0]) first.
    const shooter = order[0].nextFireAt <= order[1].nextFireAt ? order[0] : order[1];
    const t = shooter.nextFireAt;
    if (t > exposedUntil) { disengagedAtMs = exposedUntil; break; }
    if (t > p.timeBudgetMs) break;

    if (shooter.ammo < shooter.mode.ammoPerShot) {
      events.push({ kind: "reloadStart", timeMs: t, actor: shooter.c.id });
      shooter.nextFireAt = t + shooter.c.weapon.reloadTimeMs;
      shooter.ammo = shooter.c.weapon.magazineSize;
      events.push({ kind: "reloadEnd", timeMs: shooter.nextFireAt, actor: shooter.c.id });
      continue;
    }

    const target = opponentOf(shooter);
    shooter.shotsFired += 1;
    shooter.ammo -= shooter.mode.ammoPerShot;
    events.push({ kind: "shot", timeMs: t, actor: shooter.c.id, target: target.c.id });

    const isFirst = shooter.shotsFired === 1;
    const pHit = hitChance(shooter.c, target.c, duel.distanceMeters, isFirst, p, cal, t);
    let landed = shooter.rng() < pHit;
    let loc: HitLocation = "body";
    let dmg = 0;
    if (landed && shooter.mode.pellets > 1) {
      // A pull of pellets: each lands with the cone's share at this range and rolls its own location.
      const q = pelletLandChance(shooter.mode.spreadDeg, duel.distanceMeters);
      const hs = headshotChance(shooter.c, p, cal, t);
      let n = 0;
      for (let k = 0; k < shooter.mode.pellets; k++) {
        if (shooter.rng() >= q) continue;
        const l = rollLocation(shooter.rng, hs);
        if (n === 0) loc = l;
        dmg += damageForRange(shooter.c.weapon, duel.distanceMeters, l);
        n++;
      }
      landed = n > 0;
    } else if (landed) {
      loc = rollLocation(shooter.rng, headshotChance(shooter.c, p, cal, t));
      dmg = damageForRange(shooter.c.weapon, duel.distanceMeters, loc);
    }
    if (landed) {
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

    shooter.nextFireAt = t + 1000 / shooter.mode.fireRate;
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
  return { winner, loser, timeToKillMs: ttk, events, outcomes, ...(disengagedAtMs !== undefined ? { disengagedAtMs } : {}) };
}
