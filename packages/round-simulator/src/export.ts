// PROJECT V — round-simulator export: validation-harness input and PV-6 replay bridge.
//
// Both emit pv-core @pv/shared-types GameEvent-shaped events (kind/seq/tick/timeMs/...),
// which is what PV-2's sim-validation harness and PV-6's fromSimEventLog both consume.

import type { RoundResult, Side, TrackFrame } from "./types.js";

// ---- pv-core GameEvent mirror (events.ts on claude/pv-core) ----
export interface GameEventBase {
  readonly id: string;
  readonly seq: number;
  readonly tick: number;
  readonly timeMs: number;
}
export type SimGameEvent = GameEventBase & {
  readonly kind: string;
  readonly [k: string]: unknown;
};

/** Convert one round's SimEvent log into pv-core GameEvent[]. Optionally include per-tick
 *  move events derived from track frames (for PV-6 replay); omit for validation (not needed). */
export function toSimGameEvents(result: RoundResult, opts: { includeMoves?: boolean } = {}): SimGameEvent[] {
  const out: SimGameEvent[] = [];
  let seq = 0;
  const base = (tick: number, timeMs: number) => ({ id: `e${seq}`, seq: seq++, tick, timeMs });

  if (opts.includeMoves && result.tracks) {
    out.push(...moveEvents(result.tracks, () => seq++));
    out.push(...sightEvents(result.tracks, () => seq++));
  }

  for (const e of result.events) {
    switch (e.kind) {
      case "roundStart":
        out.push({ ...base(e.tick, e.elapsedMs), kind: "roundStart", roundNumber: 1 });
        break;
      case "kill":
        out.push({ ...base(e.tick, e.elapsedMs), kind: "kill", victim: e.target, killer: e.actor ?? null, assists: [], cause: "weapon", weaponId: null });
        break;
      case "abilityUsed":
        out.push({ ...base(e.tick, e.elapsedMs), kind: "abilityUse", playerId: e.actor, abilityId: e.detail ?? null, at: null });
        break;
      case "planted":
        // where the spike went down and which candidate spot it is (plant-spot.ts; RoundResult.plant)
        out.push({ ...base(e.tick, e.elapsedMs), kind: "spikePlanted", playerId: e.actor ?? null, at: result.plant?.position ?? null,
          ...(result.plant ? { siteZone: result.plant.zoneId, spotId: result.plant.spotId, spotKind: result.plant.spotKind } : {}) });
        break;
      case "defused":
        out.push({ ...base(e.tick, e.elapsedMs), kind: "spikeDefused", playerId: e.actor ?? null, at: null });
        break;
      case "detonated":
        out.push({ ...base(e.tick, e.elapsedMs), kind: "spikeDetonated", playerId: null, at: null });
        break;
      case "roundEnd":
        out.push({ ...base(e.tick, e.elapsedMs), kind: "roundEnd", winner: result.winner, reason: result.reason });
        break;
      default:
        break; // engage/plantStart/defuseStart/defuseInterrupted are sim-internal, not exported
    }
  }
  // sort by seq is already in order; moves were appended first with their own seqs, re-sort by timeMs then seq
  return out.sort((a, b) => a.timeMs - b.timeMs || a.seq - b.seq);
}

function moveEvents(tracks: readonly TrackFrame[], nextSeq: () => number): SimGameEvent[] {
  const out: SimGameEvent[] = [];
  // Where everybody starts: one zero-length move per player at the first frame, so a player who
  // never leaves their spot still has a position in the replay.
  const first = tracks[0];
  if (first) {
    for (const p of first.players) {
      const s = nextSeq();
      const at = { x: p.x, y: p.y, z: p.z };
      out.push({ id: `m${s}`, seq: s, tick: first.tick, timeMs: first.elapsedMs, kind: "move", playerId: p.id, from: at, to: at });
    }
  }
  for (let i = 1; i < tracks.length; i++) {
    const prev = tracks[i - 1], cur = tracks[i];
    const prevById = new Map(prev.players.map((p) => [p.id, p]));
    for (const p of cur.players) {
      const pp = prevById.get(p.id);
      if (!pp || !p.alive) continue;
      if (pp.x === p.x && pp.y === p.y && pp.z === p.z) continue; // no movement
      const s = nextSeq();
      out.push({ id: `m${s}`, seq: s, tick: cur.tick, timeMs: cur.elapsedMs, kind: "move", playerId: p.id, from: { x: pp.x, y: pp.y, z: pp.z }, to: { x: p.x, y: p.y, z: p.z } });
    }
  }
  return out;
}

/**
 * Per-tick perception as replay events: one `sight` event for a player whenever the set of enemies
 * it sees changes (and one at its first frame), carrying the full new set:
 *   { kind: "sight", playerId, sees: PlayerId[] (sorted), blind: boolean }
 * Replaying the latest `sight` event per player at time t gives exactly who saw whom in the
 * simulation at t (TrackFrame.sees). Dead players emit nothing further; replay-engine ignores the
 * kind until a consumer (the desktop sight overlay) reads it. Contract: docs/ENGINE_TRUTH.md §2.
 */
function sightEvents(tracks: readonly TrackFrame[], nextSeq: () => number): SimGameEvent[] {
  const out: SimGameEvent[] = [];
  const last = new Map<string, string>();
  for (const f of tracks) {
    for (const p of f.players) {
      if (!p.sees) continue;
      const key = `${p.blind ? "b" : ""}|${p.sees.join(",")}`;
      if (last.get(p.id) === key) continue;
      last.set(p.id, key);
      const s = nextSeq();
      out.push({ id: `s${s}`, seq: s, tick: f.tick, timeMs: f.elapsedMs, kind: "sight", playerId: p.id, sees: [...p.sees], blind: p.blind === true });
    }
  }
  return out;
}

// ---- PV-2 sim-validation harness input (tools/data-validator sim_run shape) ----

export interface SimRunRound {
  readonly roundNumber: number;
  readonly map: string;
  readonly roster: Readonly<Record<string, Side>>;
  readonly buyTiers: Readonly<Record<Side, string>>;
  readonly events: readonly SimGameEvent[];
}
export interface SimRun {
  readonly meta: { readonly synthetic: boolean; readonly label: string; readonly rounds: number };
  readonly rounds: readonly SimRunRound[];
}

/** Bundle round results into PV-2's `pv-validate-sim` input (sim_run.json). */
export function toValidationRun(results: readonly RoundResult[], label: string, buyTier = "full"): SimRun {
  const rounds: SimRunRound[] = results.map((r, i) => ({
    roundNumber: i + 1,
    map: "Ascent",
    roster: r.roster,
    buyTiers: { attack: buyTier, defense: buyTier },
    events: toSimGameEvents(r),
  }));
  return { meta: { synthetic: true, label, rounds: results.length }, rounds };
}
