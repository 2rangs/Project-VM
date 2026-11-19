// Pure view logic for the series / veto screens (unit-tested in test/series-view.test.ts).
// Everything the screens DERIVE from the SeriesView lives here; the numbers themselves come from
// @pv/match-runner untouched (mastery, scouting, the AI's recommended choice).
import type { SeriesGameView, SeriesMapView, SeriesTeam, SeriesView, StartSide, VetoActionView } from '../../shared/series.ts';

// ── how certain a mastery number is ─────────────────────────────────────────────
// `uncertainty` is one standard deviation of the 0..1 estimate. Below 0.06 the number is read as
// is; from 0.10 up the error bar is about as wide as the gaps the veto is decided on, so the UI
// must not present it as a fact (hatched bar, amber ± — same treatment as low-confidence reads in
// the post-match Review).
export type CertaintyLevel = 'high' | 'medium' | 'low';
export const UNCERTAINTY_MEDIUM = 0.06;
export const UNCERTAINTY_LOW = 0.1;
export function certaintyLevel(uncertainty: number): CertaintyLevel {
  if (uncertainty >= UNCERTAINTY_LOW) return 'low';
  if (uncertainty >= UNCERTAINTY_MEDIUM) return 'medium';
  return 'high';
}

export const pct = (x: number): number => Math.round(x * 100);
/** Mastery on a 0–100 scale for display. */
export const score100 = (x: number): number => Math.round(x * 100);

// ── map cards ───────────────────────────────────────────────────────────────────
export type MapStatus = 'open' | 'banned' | 'picked' | 'decider';
export interface MapCard {
  map: string;
  status: MapStatus;
  /** Who banned / picked it (null for an open map or the decider). */
  by: SeriesTeam | null;
  /** Playing order (1-based) once the map is in the series. */
  gameNumber: number | null;
  /** Our starting side once chosen. */
  ourSide: StartSide | null;
  /** The pending step is ours and this map can be chosen now. */
  selectable: boolean;
  /** This is what our staff recommends for the pending step. */
  recommended: boolean;
  /** The finished game on this map, if played. */
  played: SeriesGameView | null;
  info: SeriesMapView;
}

export function mapCards(view: SeriesView): MapCard[] {
  const pending = view.veto.pending;
  const ourMapStep = pending && !pending.ai && pending.kind !== 'side' ? pending : null;
  return view.maps.map((info) => {
    const ban = view.veto.actions.find((a) => a.kind === 'ban' && a.map === info.map);
    const entered = view.veto.actions.find((a) => (a.kind === 'pick' || a.kind === 'decider') && a.map === info.map);
    const order = view.veto.actions.filter((a) => a.kind === 'pick' || a.kind === 'decider').findIndex((a) => a.map === info.map);
    const settled = view.veto.maps.find((m) => m.map === info.map);
    const status: MapStatus = ban ? 'banned' : entered ? (entered.kind === 'decider' ? 'decider' : 'picked') : 'open';
    return {
      map: info.map,
      status,
      by: ban?.team ?? (entered?.kind === 'pick' ? entered.team : null),
      gameNumber: order >= 0 ? order + 1 : null,
      ourSide: settled ? settled.startingSides.A : null,
      selectable: status === 'open' && !!ourMapStep && ourMapStep.options.includes(info.map),
      recommended: status === 'open' && !!ourMapStep && ourMapStep.recommendation.choice === info.map,
      played: view.games.find((g) => g.map === info.map) ?? null,
      info,
    };
  });
}

// ── whose turn, which step ──────────────────────────────────────────────────────
export interface StepInfo {
  /** 1-based position among the steps somebody chooses (deciders excluded). */
  index: number;
  total: number;
  kind: 'ban' | 'pick' | 'side';
  team: SeriesTeam;
  ours: boolean;
  /** For a side step: the map the side is chosen on. */
  map: string | null;
}
export function stepInfo(view: SeriesView): StepInfo | null {
  const p = view.veto.pending;
  if (!p) return null;
  const chosen = view.format.steps.map((s, i) => ({ s, i })).filter((x) => x.s.kind !== 'decider');
  const index = chosen.findIndex((x) => x.i === p.step) + 1;
  return { index, total: chosen.length, kind: p.kind, team: p.team, ours: !p.ai, map: p.map ?? null };
}

// ── the recommendation, in the manager's words ──────────────────────────────────
/** What we believe the opponent's mastery of a map is: the scouting estimate, else unknown (null). */
export function theirMasteryEstimate(m: SeriesMapView): number | null {
  return m.scouting ? m.scouting.estimatedMastery : null;
}
export interface Reason { key: string; vars: Record<string, string | number> }

/**
 * Why the staff recommends the pending choice. The CHOICE is the engine's (it searches the rest
 * of the veto on our win estimates); this only words the visible numbers behind it:
 *  - ban:  with a scouting estimate where they are ahead of us → "their edge"; otherwise our own weakest map
 *  - pick: with a scouting estimate → "our edge over them"; otherwise our own strongest map
 *  - side: the map's attack-side round win rate in the data, or the conventional defense start
 */
export function recommendationReason(view: SeriesView): Reason | null {
  const p = view.veto.pending;
  if (!p || p.ai) return null;
  const choice = p.recommendation.choice;
  if (p.kind === 'side') {
    const m = view.maps.find((x) => x.map === p.map);
    const atk = m?.atkRoundWR ?? null;
    if (atk === null) return { key: 'ser.rec.side.nodata', vars: { map: p.map ?? '' } };
    return choice === 'attack'
      ? { key: 'ser.rec.side.attack', vars: { map: p.map ?? '', pct: (atk * 100).toFixed(1) } }
      : { key: 'ser.rec.side.defense', vars: { map: p.map ?? '', pct: ((1 - atk) * 100).toFixed(1) } };
  }
  const m = view.maps.find((x) => x.map === choice);
  if (!m) return null;
  const ours = score100(m.mastery.A.value);
  const est = theirMasteryEstimate(m);
  if (p.kind === 'ban') {
    if (est !== null && est > m.mastery.A.value) return { key: 'ser.rec.ban.edge', vars: { map: choice, ours, theirs: score100(est), gap: score100(est) - ours } };
    return { key: 'ser.rec.ban.weak', vars: { map: choice, ours } };
  }
  if (est !== null) return { key: 'ser.rec.pick.edge', vars: { map: choice, ours, theirs: score100(est), gap: ours - score100(est) } };
  return { key: 'ser.rec.pick.best', vars: { map: choice, ours } };
}

// ── veto log ────────────────────────────────────────────────────────────────────
/** One line per veto action, newest last: an i18n key + vars (team names are filled by the caller). */
export function vetoLogLine(a: VetoActionView): { key: string; team: SeriesTeam | null; vars: Record<string, string> } {
  if (a.kind === 'decider') return { key: 'ser.log.decider', team: null, vars: { map: a.map } };
  if (a.kind === 'side') return { key: a.side === 'attack' ? 'ser.log.side.attack' : 'ser.log.side.defense', team: a.team, vars: { map: a.map } };
  return { key: a.kind === 'ban' ? 'ser.log.ban' : 'ser.log.pick', team: a.team, vars: { map: a.map } };
}

/** True when any map of the series is not the map whose geometry is simulated. */
export function usesBorrowedGeometry(view: SeriesView): boolean {
  return view.pool.some((m) => m.toLowerCase() !== view.geometry.toLowerCase());
}
