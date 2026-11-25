// Pure view logic for the in-match manager UI (screens/matchday/Manager*.tsx, PrematchPanel.tsx,
// PostMatchSummary.tsx). Unit-tested in test/manager-view.test.ts. The numbers come from the engine
// untouched (packages/match-runner manager.ts); this only decides how they read.
import type { SessionState } from '../../shared/ipc.ts';
import type {
  AlertView, DecisionView, ManagerStateView, MatchPlan, OpponentReportView, PlayerMindView, Rate, Seat, SiteEvidenceView,
} from '../../shared/manager.ts';

import { tacticsOnly } from '../tactics/plan.ts';

export const OUR: Seat = 'A';

// ── state of mind ───────────────────────────────────────────────────────────────────────────
export type MoodLabel = 'tilted' | 'shaky' | 'steady' | 'confident';
/** Same threshold as the engine's tilt alert (MORALE_MODEL.tiltAlert = 0.45). */
export const TILT_ALERT = 0.45;
export function moodLabel(p: Pick<PlayerMindView, 'tilt' | 'confidence'>): MoodLabel {
  if (p.tilt >= TILT_ALERT) return 'tilted';
  if (p.tilt >= 0.2) return 'shaky';
  if (p.confidence >= 0.3) return 'confident';
  return 'steady';
}
/** Mood (−1..1) as a 0..100 bar, 50 = neutral. */
export const moodBar = (mood: number): number => Math.round(50 + 50 * Math.max(-1, Math.min(1, mood)));
/** Personality in plain words: composure decides how losses land, drive how being pushed lands. */
export function personalityTags(p: PlayerMindView['personality']): string[] {
  const out: string[] = [];
  if (p.composure >= 0.7) out.push('composed'); else if (p.composure < 0.5) out.push('fragile');
  if (p.drive >= 0.7) out.push('driven'); else if (p.drive < 0.4) out.push('reserved');
  return out;
}

// ── alerts and auto-pause ─────────────────────────────────────────────────────────────────────
/** Our alerts raised for the round about to be played. */
export function ourAlerts(state: SessionState | null): AlertView[] {
  const m = state?.manager;
  if (!m || state!.finished) return [];
  return m.alerts.filter((a) => a.team === OUR && a.round === state!.roundNumber);
}
/** A stable key for the alerts of one round (auto-pause fires once per round's set). */
export function alertKey(alerts: AlertView[]): string {
  return alerts.map((a) => `${a.round}:${a.kind}:${a.player?.index ?? ''}`).join('|');
}
/** The i18n key and vars of an alert line. */
export function alertLine(a: AlertView): { key: string; vars: Record<string, string | number> } {
  switch (a.kind) {
    case 'lossRun': return { key: 'mgr.alert.lossRun', vars: { n: a.streak ?? 0 } };
    case 'economyBroken': return { key: 'mgr.alert.economy', vars: { c: a.creditsPerPlayer ?? 0 } };
    case 'playerTilt': return { key: a.player?.key ? 'mgr.alert.keyTilt' : 'mgr.alert.tilt', vars: { name: a.player?.handle ?? `#${(a.player?.index ?? 0) + 1}`, pct: Math.round(100 * (a.player?.tilt ?? 0)) } };
    case 'halfTime': return { key: 'mgr.alert.halfTime', vars: {} };
  }
}
/** Whether our half-time talk is waiting. */
export const talkPending = (m: ManagerStateView | undefined): boolean => !!m?.halfTime?.pending[OUR];

// ── team talk reactions ───────────────────────────────────────────────────────────────────────
export type Reaction = 'lifted' | 'unmoved' | 'rattled';
export function reaction(delta: number): Reaction {
  if (delta >= 0.05) return 'lifted';
  if (delta <= -0.03) return 'rattled';
  return 'unmoved';
}

// ── post-match: decisions and what followed ──────────────────────────────────────────────────
export interface DecisionRow {
  decision: DecisionView;
  /** i18n key of the decision's label. */
  key: string;
  vars: Record<string, string | number>;
  before: string; // "1/3"
  after: string;
  /** Rounds won in the window after minus before (null when either window is empty). */
  swing: number | null;
  tiltBefore: number;
  tiltAfter: number;
}
export function decisionRows(decisions: DecisionView[], team: Seat): DecisionRow[] {
  return decisions.filter((d) => d.team === team).map((d) => {
    let key = `mgr.dec.${d.kind}`;
    const vars: Record<string, string | number> = { round: d.round };
    if (d.kind === 'talk' && d.talk) vars.talk = d.talk;
    if (d.kind === 'timeout' && d.reason) key = 'mgr.dec.timeout.reason';
    if (d.reason) vars.reason = d.reason;
    if (d.kind === 'strategy') vars.what = [d.strategy?.attack, d.strategy?.defense].filter(Boolean).join(' / ') || '—';
    if (d.kind === 'shouts' && d.shouts) Object.assign(vars, d.shouts);
    if (d.kind === 'orders' && d.order) vars.what = [d.order.strategy, d.order.economy].filter(Boolean).join(' / ') || '—';
    const swing = d.roundsBefore.played && d.roundsAfter.played
      ? d.roundsAfter.won / d.roundsAfter.played * 3 - d.roundsBefore.won / d.roundsBefore.played * 3
      : null;
    return {
      decision: d, key, vars,
      before: `${d.roundsBefore.won}/${d.roundsBefore.played}`,
      after: `${d.roundsAfter.won}/${d.roundsAfter.played}`,
      swing: swing === null ? null : Math.round(swing * 10) / 10,
      tiltBefore: d.before.tilt, tiltAfter: d.tiltAfter,
    };
  });
}
/** A tiny sparkline path (0..1 values) for the tilt chart. */
export function sparkPath(values: number[], w = 240, h = 40): string {
  if (values.length === 0) return '';
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * step).toFixed(1)},${(h - Math.max(0, Math.min(1, v)) * h).toFixed(1)}`).join(' ');
}

// ── pre-match report ──────────────────────────────────────────────────────────────────────────
export const pct = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : `${Math.round(100 * x)}%`);
/** A rate with its sample size; thin samples (< 4) are flagged so the UI can grey them. */
export function rateText(r: Rate): { text: string; thin: boolean } {
  return { text: r.rate === null ? '—' : `${pct(r.rate)} (${r.n})`, thin: r.n < 4 };
}
/** Site lean in words: the site with ≥ 60% of the evidence, or "no lean", plus how much evidence. */
export function siteLean(e: SiteEvidenceView): { site: 'A' | 'B' | null; share: number; rounds: number; thin: boolean } {
  const a = e.share.A;
  const site = e.rounds === 0 ? null : a >= 0.6 ? 'A' : a <= 0.4 ? 'B' : null;
  return { site, share: site === 'B' ? 1 - a : a, rounds: Math.round(e.rounds * 10) / 10, thin: e.rounds < 8 };
}
/** The report's lines the plan screen shows first (i18n key + vars). */
export function reportHeadlines(r: OpponentReportView): Array<{ key: string; vars: Record<string, string | number>; thin: boolean }> {
  const out: Array<{ key: string; vars: Record<string, string | number>; thin: boolean }> = [];
  const atk = siteLean(r.sites.map.attack.rounds >= 8 ? r.sites.map.attack : r.sites.all.attack);
  out.push(atk.site ? { key: 'pre.head.attack', vars: { site: atk.site, pct: pct(atk.share), n: atk.rounds }, thin: atk.thin } : { key: 'pre.head.attack.none', vars: { n: atk.rounds }, thin: atk.thin });
  const def = siteLean(r.sites.map.defense.rounds >= 8 ? r.sites.map.defense : r.sites.all.defense);
  out.push(def.site ? { key: 'pre.head.defense', vars: { site: def.site, pct: pct(def.share), n: def.rounds }, thin: def.thin } : { key: 'pre.head.defense.none', vars: { n: def.rounds }, thin: def.thin });
  const pf = rateText(r.pistol.forceAfterLoss);
  out.push({ key: 'pre.head.pistolForce', vars: { v: pf.text }, thin: pf.thin });
  const ef = rateText(r.eco.forceAfterLoss);
  out.push({ key: 'pre.head.ecoForce', vars: { v: ef.text }, thin: ef.thin });
  const danger = r.players.find((p) => p.tag === 'danger');
  if (danger) out.push({ key: 'pre.head.danger', vars: { name: danger.handle ?? '?' }, thin: r.gamesReviewed === 0 });
  return out;
}

// ── plan ──────────────────────────────────────────────────────────────────────────────────────
/** A plan with nothing set (the IGL decides everything). */
export const EMPTY_PLAN: MatchPlan = { tempo: 'normal', risk: 'normal', defense: 'normal', useScouting: false };
/** Only what differs from the IGL's own play is sent to the engine. */
export function planForEngine(plan: MatchPlan): MatchPlan | undefined {
  const out: MatchPlan = {
    ...(plan.attackLean && plan.attackLean.strength > 0 ? { attackLean: plan.attackLean } : {}),
    ...(plan.defenseLean && plan.defenseLean.strength > 0 ? { defenseLean: plan.defenseLean } : {}),
    ...(plan.tempo && plan.tempo !== 'normal' ? { tempo: plan.tempo } : {}),
    ...(plan.risk && plan.risk !== 'normal' ? { risk: plan.risk } : {}),
    ...(plan.defense && plan.defense !== 'normal' ? { defense: plan.defense } : {}),
    ...(plan.pistol && (plan.pistol.attack || plan.pistol.defense) ? { pistol: plan.pistol } : {}),
    ...(plan.afterPistolLoss ? { afterPistolLoss: plan.afterPistolLoss } : {}),
    ...(plan.useScouting ? { useScouting: true } : {}),
    // [tactics] plant / post-plant / retake / mid, already kept minimal by the tactics screen
    ...tacticsOnly(plan),
  };
  return Object.keys(out).length ? out : undefined;
}
