/**
 * Floor items during a round: dropped guns and ultimate orbs.
 *
 * Guns. A player who dies drops the gun they held where they fell. A living player takes a gun off
 * the floor when it is worth more than the one they hold, it lies within reach (PICKUP_REACH_UNITS,
 * a step or two, same height band) and the moment allows it: they see no enemy this tick and are
 * not planting or defusing. Their own gun goes on the floor in its place (it can be picked up in
 * turn). One swap per player per tick.
 *
 * Orbs. Points from `<map>.objects.json` `ultOrbs` (maps data). An orb is taken once per round, by
 * the first living player who reaches it while the moment allows (as for guns); the round emits
 * `orbPickup` with the player as `actor` — match-runner credits one ultimate point per event. Orbs
 * are only present when the caller opts in (match-runner `MatchConfig.ultOrbs`, default off); with
 * no orb points, nothing happens.
 *
 * The simulator calls `step` once per tick after the fights and the spike pickup (one hook). Nothing
 * here moves players: a pickup happens where routes already take them.
 */
import type { Vector3 } from "@pv/perception-engine";
import type { PlayerId, SimEvent, SimPlayer, SimState } from "./types.js";

/** Reach for a pickup (game units, 100 uu = 1 m): about two steps. */
export const PICKUP_REACH_UNITS = 200;
/** Height band: an item on another floor is out of reach. */
const REACH_HEIGHT_UNITS = 150;

export interface OrbPoint {
  readonly id: string;
  readonly position: Vector3;
}

export interface FloorWeapon {
  readonly weaponId: string;
  readonly position: Vector3;
  readonly zoneId: string;
  /** Who dropped it: the dead player, or the player who swapped it for something better. */
  readonly from: PlayerId;
}

export interface FloorItemsOptions {
  /** Shop price of a weapon id (decides "better"); unknown → 0 (never taken). */
  readonly priceOf: (weaponId: string) => number;
  readonly orbs?: readonly OrbPoint[];
  /** The weapon nobody picks up (the free sidearm). */
  readonly defaultWeaponId?: string;
}

type Push = (e: SimEvent) => void;

export class FloorItems {
  private readonly floor: FloorWeapon[] = [];
  private readonly orbsLeft: OrbPoint[];
  private readonly aliveLast = new Map<PlayerId, boolean>();

  constructor(private readonly opts: FloorItemsOptions) {
    this.orbsLeft = [...(opts.orbs ?? [])];
  }

  /** Guns on the floor now (read-only view, for tests and the round result). */
  get weapons(): readonly FloorWeapon[] {
    return this.floor;
  }

  /**
   * One tick. `busy(id)` says whether the moment does not allow a pickup (an enemy in sight,
   * planting, defusing).
   */
  step(state: SimState, busy: (p: SimPlayer) => boolean, push: Push): void {
    // Deaths since the last tick drop their guns.
    for (const p of state.players) {
      const was = this.aliveLast.get(p.id) ?? true;
      if (was && !p.alive && p.weaponId !== this.opts.defaultWeaponId) {
        this.floor.push({ weaponId: p.weaponId, position: { ...p.position }, zoneId: p.zoneId, from: p.id });
      }
      this.aliveLast.set(p.id, p.alive);
    }
    if (this.floor.length === 0 && this.orbsLeft.length === 0) return;

    for (const p of state.players) {
      if (!p.alive || busy(p)) continue;
      // Guns: the most valuable one in reach that beats what the player holds.
      const held = this.opts.priceOf(p.weaponId);
      let best = -1;
      for (let i = 0; i < this.floor.length; i++) {
        const w = this.floor[i]!;
        if (!inReach(p.position, w.position)) continue;
        const price = this.opts.priceOf(w.weaponId);
        if (price > held && (best < 0 || price > this.opts.priceOf(this.floor[best]!.weaponId))) best = i;
      }
      if (best >= 0) {
        const taken = this.floor[best]!;
        const dropped = p.weaponId;
        this.floor.splice(best, 1);
        if (dropped !== this.opts.defaultWeaponId) this.floor.push({ weaponId: dropped, position: { ...taken.position }, zoneId: taken.zoneId, from: p.id });
        p.weaponId = taken.weaponId;
        push({ kind: "weaponPickup", tick: state.tick, elapsedMs: state.elapsedMs, actor: p.id, target: taken.from, zoneId: p.zoneId, detail: `${taken.weaponId}|${dropped}` });
      }
      // Orbs.
      for (let i = 0; i < this.orbsLeft.length; i++) {
        if (!inReach(p.position, this.orbsLeft[i]!.position)) continue;
        const orb = this.orbsLeft.splice(i, 1)[0]!;
        push({ kind: "orbPickup", tick: state.tick, elapsedMs: state.elapsedMs, actor: p.id, zoneId: p.zoneId, detail: orb.id });
        break;
      }
    }
  }
}

function inReach(a: Vector3, b: Vector3): boolean {
  if (Math.abs(a.z - b.z) > REACH_HEIGHT_UNITS) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= PICKUP_REACH_UNITS;
}
