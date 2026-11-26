// Live round win probability (라운드 승률) — a cheap, deterministic estimate for the viewer, from
// the round's event state only: alive counts, the spike clock, round time and each team's loadout
// value. It is PRESENTATION, not engine truth: it reads the recorded round (it never drives the
// simulation), and it is pinned to the real outcome once the round is over, so it can never
// contradict the engine's result.
//
// The logistic weights (winprob-coef.ts / winprob-coef.json) are fitted offline from engine match
// data by scripts/fit-winprob.mts — real rosters, Ascent, seeds 1–160 train / 161–320 validate.
// The feature extraction here (wpStateAt / wpFeatures) is the SINGLE source of truth shared by the
// fitter and the runtime, so the fitted weights describe exactly what the screen computes.
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
import { ENGINE, roundOver, type RoundTimeline, type TeamSlot } from './timeline.ts';
import { WP_COEF } from './winprob-coef.ts';

/** Credits of loadout-value gap that saturates the equipment term. */
export const EQUIP_SCALE = 4000;
const PROB_FLOOR = 0.02;
const PROB_CEIL = 0.98;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const clamp = (lo: number, hi: number, x: number) => Math.min(hi, Math.max(lo, x));
const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** The round state the win-probability model reads, extracted once so the fitter and runtime agree. */
export interface WpState {
  readonly aliveAtt: number;
  readonly aliveDef: number;
  readonly planted: boolean;
  readonly defusing: boolean;
  readonly defuseProgress: number;   // 0..1 while a defuse is in progress
  readonly spikeElapsedFrac: number; // 0..1 of the spike timer, planted & not defusing
  readonly clockFrac: number;        // 0..1 of the round clock remaining (pre-plant time pressure)
  readonly equipDiffNorm: number;    // clamp((eqAtt − eqDef)/EQUIP_SCALE, −1, 1)
}

/** The logistic coefficients (intercept + one per feature of wpFeatures, in order). */
export interface WpCoef {
  readonly b0: number;
  readonly man: number;
  readonly equip: number;
  readonly plant: number;
  readonly spikeTime: number;
  readonly defuse: number;
  readonly preplant: number;
}

/** Team loadout value this round from the summary buys, if the engine recorded it. */
function loadoutValue(round: RoundTimeline, team: TeamSlot): number | null {
  const buy = round.summary?.buys?.[team];
  if (!buy) return null;
  if (typeof buy.loadoutValue === 'number') return buy.loadoutValue;
  const players = buy.players;
  if (players && players.length > 0) return players.reduce((s, p) => s + (p.loadoutValue ?? 0), 0);
  return null;
}

/** Extract the win-probability state at tMs. Shared by the fitter (labels) and the live screen. */
export function wpStateAt(round: RoundTimeline, tMs: number): WpState {
  const s = situationAt(round, tMs);
  const defender: TeamSlot = round.attacker === 'A' ? 'B' : 'A';
  const planted = s.spike.phase === 'planted' || s.spike.phase === 'defusing';
  const defusing = s.spike.phase === 'defusing';
  const eqAtt = loadoutValue(round, round.attacker);
  const eqDef = loadoutValue(round, defender);
  return {
    aliveAtt: s.alive[round.attacker],
    aliveDef: s.alive[defender],
    planted,
    defusing,
    defuseProgress: defusing ? clamp01(s.spike.progress ?? 0) : 0,
    spikeElapsedFrac: planted && !defusing && s.spike.remainingMs != null ? 1 - clamp01(s.spike.remainingMs / ENGINE.spikeTimerMs) : 0,
    clockFrac: clamp01(s.clockMs / ENGINE.roundTimeMs),
    equipDiffNorm: eqAtt != null && eqDef != null ? clamp(-1, 1, (eqAtt - eqDef) / EQUIP_SCALE) : 0,
  };
}

/** The model's feature vector (order matches WpCoef after the intercept). */
export function wpFeatures(st: WpState): [number, number, number, number, number, number] {
  const man = st.aliveAtt - st.aliveDef;
  const plant = st.planted ? 1 : 0;
  const spikeTime = st.planted && !st.defusing ? st.spikeElapsedFrac : 0;
  const defuse = st.defusing ? st.defuseProgress : 0;
  const preplant = st.planted ? 0 : st.clockFrac * 2 - 1;
  return [man, st.equipDiffNorm, plant, spikeTime, defuse, preplant];
}

/** Logit z = b0 + Σ coef·feature. */
export function wpLogit(coef: WpCoef, st: WpState): number {
  const [man, equip, plant, spikeTime, defuse, preplant] = wpFeatures(st);
  return coef.b0 + coef.man * man + coef.equip * equip + coef.plant * plant + coef.spikeTime * spikeTime + coef.defuse * defuse + coef.preplant * preplant;
}

/**
 * P(the attacking team wins the round) at tMs, in [PROB_FLOOR, PROB_CEIL] while the round is live,
 * and exactly 1/0 once it is over (pinned to the engine's winner). Terminal man-count states
 * (a side wiped) are hard overrides, not part of the fitted logistic.
 */
export function attackerWinProb(round: RoundTimeline, tMs: number): number {
  if (roundOver(round, tMs) && round.summary) return round.summary.winner === round.attacker ? 1 : 0;
  const st = wpStateAt(round, tMs);
  if (st.aliveAtt === 0 && !st.planted) return PROB_FLOOR;                         // no one left to plant
  if (st.aliveAtt === 0 && st.planted) return st.defusing ? PROB_FLOOR : 0.12;     // defenders free to defuse
  if (st.aliveDef === 0) return st.planted ? PROB_CEIL : 0.9;                      // attackers must still plant in time
  return Math.min(PROB_CEIL, Math.max(PROB_FLOOR, sigmoid(wpLogit(WP_COEF, st))));
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

/** The viewer team's win-probability change across one round event (before → after). */
export function swingAt(round: RoundTimeline, tMs: number, team: TeamSlot): { before: number; after: number; delta: number } {
  const before = teamWinProb(round, Math.max(round.startMs, tMs - BEFORE_MS), team);
  const after = teamWinProb(round, tMs + AFTER_MS, team);
  return { before, after, delta: after - before };
}

/**
 * The moments that moved the viewer team's win probability most, biggest first. Each round event
 * (kill / plant / defuse / end) is evaluated just before and just after; those past the threshold
 * are returned. Used to mark the scrubber, to list "the round turned here", and to choose which
 * moments the 'key' highlight level shows.
 */
export function swingMoments(round: RoundTimeline, team: TeamSlot, limit = 4): SwingMoment[] {
  const out: SwingMoment[] = [];
  for (const m of roundMarks(round)) {
    const { after, delta } = swingAt(round, m.tMs, team);
    if (Math.abs(delta) >= SWING_THRESHOLD) out.push({ tMs: m.tMs, kind: m.kind, delta, after });
  }
  return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, limit);
}
