// Live round win probability (라운드 승률) — a cheap, deterministic estimate for the viewer, from
// the round's event state only: alive counts, the spike clock, round time and each team's loadout
// value. It is PRESENTATION, not engine truth: it reads the recorded round (it never drives the
// simulation), and it is pinned to the real outcome once the round is over, so it can never
// contradict the engine's result.
//
// Why this and not @pv/outcome-predictor: that package is the engine's action ranker (it scores a
// player's candidate actions through PolicyView/SpatialQuery during the sim). What the match screen
// needs is a state→probability read over the finished round, which the research
// (COMPARABLES §C.2: alive count, equipment and HP dominate CS round win probability) says is well
// approximated by a small logistic over exactly the fields we already have here. Costs a few
// arithmetic ops per evaluation — safe on the weakest machine and on every highlight skip.
//
// Pure module: runs under `node --test`.
import { roundMarks, situationAt, type MarkKind } from './monitor.ts';
import { roundOver, type RoundTimeline, type TeamSlot } from './timeline.ts';
import { ENGINE } from './timeline.ts';

// Logistic weights. Hand-set to read plausibly (one extra player ≈ a strong edge; a plant is a big
// attacker swing; a near-complete defuse hands it back), NOT fitted to engine output — see the
// module header. Tuning these never changes a simulated result.
const W = {
  man: 0.82,        // per net alive-player advantage (attacker − defender)
  equip: 0.55,      // per normalised loadout-value advantage, clamped to ±1
  equipScale: 4000, // credits of loadout gap that saturates the equip term
  plant: 1.15,      // post-plant attacker swing
  defuse: 2.6,      // defender swing as a defuse completes (× progress)
  preplantTime: 0.5, // attacker edge when time is plentiful pre-plant, decaying to a defender edge
  spikeTime: 0.6,   // extra attacker edge as the spike timer runs down with no defuse
} as const;

const PROB_FLOOR = 0.02;
const PROB_CEIL = 0.98;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Team loadout value this round from the summary buys, if the engine recorded it. */
function loadoutValue(round: RoundTimeline, team: TeamSlot): number | null {
  const buy = round.summary?.buys?.[team];
  if (!buy) return null;
  if (typeof buy.loadoutValue === 'number') return buy.loadoutValue;
  const players = buy.players;
  if (players && players.length > 0) return players.reduce((s, p) => s + (p.loadoutValue ?? 0), 0);
  return null;
}

/**
 * P(the attacking team wins the round) at tMs, in [PROB_FLOOR, PROB_CEIL] while the round is live,
 * and exactly 1/0 once it is over (pinned to the engine's winner).
 */
export function attackerWinProb(round: RoundTimeline, tMs: number): number {
  if (roundOver(round, tMs) && round.summary) return round.summary.winner === round.attacker ? 1 : 0;

  const s = situationAt(round, tMs);
  const defender: TeamSlot = round.attacker === 'A' ? 'B' : 'A';
  const aliveAtt = s.alive[round.attacker];
  const aliveDef = s.alive[defender];
  const planted = s.spike.phase === 'planted' || s.spike.phase === 'defusing';

  // Terminal-ish states dominate everything else.
  if (aliveAtt === 0 && !planted) return PROB_FLOOR;      // no one left to plant
  if (aliveAtt === 0 && planted) return s.spike.phase === 'defusing' ? PROB_FLOOR : 0.12; // defenders free to defuse
  if (aliveDef === 0) return planted ? PROB_CEIL : 0.9;   // attackers must still plant in time

  let z = W.man * (aliveAtt - aliveDef);

  const eqAtt = loadoutValue(round, round.attacker);
  const eqDef = loadoutValue(round, defender);
  if (eqAtt != null && eqDef != null) {
    z += W.equip * Math.max(-1, Math.min(1, (eqAtt - eqDef) / W.equipScale));
  }

  if (planted) {
    z += W.plant;
    if (s.spike.phase === 'defusing') z -= W.defuse * clamp01(s.spike.progress ?? 0);
    else if (s.spike.remainingMs != null) z += W.spikeTime * (1 - clamp01(s.spike.remainingMs / ENGINE.spikeTimerMs));
  } else {
    const tf = clamp01(s.clockMs / ENGINE.roundTimeMs);
    z += W.preplantTime * (tf * 2 - 1); // +time → attacker edge, low time → defender edge
  }

  return Math.min(PROB_CEIL, Math.max(PROB_FLOOR, sigmoid(z)));
}

/** P(team wins the round) at tMs. */
export function teamWinProb(round: RoundTimeline, tMs: number, team: TeamSlot): number {
  const p = attackerWinProb(round, tMs);
  return team === round.attacker ? p : 1 - p;
}

export interface SwingMoment {
  readonly tMs: number;
  readonly kind: MarkKind;
  /** Change in the viewer team's win probability across the event (positive = swung our way). */
  readonly delta: number;
  /** The viewer team's win probability just after the event. */
  readonly after: number;
}

/** How much win-probability change counts as a swing worth marking. */
export const SWING_THRESHOLD = 0.08;
const BEFORE_MS = 250;
const AFTER_MS = 350;

/**
 * The moments that moved the viewer team's win probability most, biggest first. Each round event
 * (kill / plant / defuse / end) is evaluated just before and just after; those past the threshold
 * are returned. Used to mark the scrubber and to list "the round turned here" in the summary.
 */
export function swingMoments(round: RoundTimeline, team: TeamSlot, limit = 4): SwingMoment[] {
  const out: SwingMoment[] = [];
  for (const m of roundMarks(round)) {
    const before = teamWinProb(round, Math.max(round.startMs, m.tMs - BEFORE_MS), team);
    const after = teamWinProb(round, m.tMs + AFTER_MS, team);
    const delta = after - before;
    if (Math.abs(delta) >= SWING_THRESHOLD) out.push({ tMs: m.tMs, kind: m.kind, delta, after });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}
