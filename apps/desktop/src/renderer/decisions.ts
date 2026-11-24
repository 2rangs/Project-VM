// Post-match "round decisions" view model: turns the engine's RoundRecord.decisions
// (plans, pre-round opponent reads, observations) into what the Review screen
// renders — one analyst note per team per round, plus a match-level adaptation
// summary. Pure data → data (no React, no i18n): the panel only picks strings.
//
// Everything here is derived from what the engine recorded; nothing is invented.
// The two derived judgements are spelled out where they are computed:
//   - `stance`: did the opening call go WITH the read the team held?
//   - `check`:  did that read match what the round then showed?
import type {
  MatchRoundSummary, MatchSummary, OpponentRead, PlanSummary, RoundObserved,
  SiteKey, TeamSlot, TendencyEstimate,
} from '../shared/ipc.ts';
import { parseReason, type ReasonLabel } from './decision-reasons.ts';

export type Side = 'attack' | 'defense';

// ── confidence ──────────────────────────────────────────────────────────────
// confidence = N / (N + 2α) (Dirichlet, see team-engine opponent-model.ts): 0 with
// no observations, ~0.33 after one (α = 1), ~0.5 after two, and it saturates near
// 0.77 because old rounds decay. LOW is set so that a single round of evidence reads
// as low for an ordinary team: the engine barely tilts a call on it, so the UI must
// not present the percentage as a real read.
export type ConfidenceLevel = 'none' | 'low' | 'medium' | 'high';
export const CONFIDENCE_LOW = 0.4;
export const CONFIDENCE_HIGH = 0.6;
/** Probabilities within this distance of 50% are shown as an even split, not a lean. */
export const EVEN_MARGIN = 0.02;

export function confidenceLevel(confidence: number): ConfidenceLevel {
  if (!(confidence > 0)) return 'none';
  if (confidence < CONFIDENCE_LOW) return 'low';
  if (confidence < CONFIDENCE_HIGH) return 'medium';
  return 'high';
}

// ── call labels ─────────────────────────────────────────────────────────────
// Plan fields are TeamStrategy ids, but revision from/to are free strings: the slow
// default commits as "midControl (slow)" → "commit B". Parse what we recognise so it
// can be localised; anything else is shown raw.
const STRATEGY_IDS = new Set([
  'default', 'aExecute', 'bExecute', 'cExecute', 'midControl', 'fakeAtoB', 'fakeBtoA', 'lurkDefault', 'save',
  'defaultHold', 'aggroPush', 'stackA', 'stackB', 'stackC', 'retake',
]);
export type CallLabel =
  | { kind: 'strategy'; id: string; slow: boolean }
  | { kind: 'commit'; site: string }
  /** A defensive rotation: everyone available stacks the site, or `count` players support it. */
  | { kind: 'rotate'; mode: 'stack' | 'support'; site: string; count: number }
  /** The rotation is stood down: back to holding. */
  | { kind: 'hold' }
  | { kind: 'raw'; text: string };

export function parseCall(text: string): CallLabel {
  const commit = /^commit ([A-Za-z])$/.exec(text);
  if (commit) return { kind: 'commit', site: commit[1].toUpperCase() };
  const rotate = /^(stack|support) ([A-Z]) ×(\d+)$/.exec(text);
  if (rotate) return { kind: 'rotate', mode: rotate[1] as 'stack' | 'support', site: rotate[2], count: Number(rotate[3]) };
  if (text === 'hold') return { kind: 'hold' };
  const slow = / \(slow\)$/.test(text);
  const id = slow ? text.replace(/ \(slow\)$/, '') : text;
  return STRATEGY_IDS.has(id) ? { kind: 'strategy', id, slow } : { kind: 'raw', text };
}

/** "a-site" → "A". Zone ids that are not a lettered site are returned unchanged. */
export function siteOfZone(zoneId: string | null | undefined): string | null {
  if (!zoneId) return null;
  const m = /^([a-z])-/.exec(zoneId);
  return m ? m[1].toUpperCase() : zoneId;
}

/** Round clock remaining, m:ss (83100 → "1:23"). */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

// ── per-team note ───────────────────────────────────────────────────────────
export interface TendencyView {
  /** Which opponent behaviour this estimate is about. */
  about: Side;
  /** True for the estimate that matters on the side this team played this round. */
  used: boolean;
  /** The likelier site, or null when there is no data or the split is even. */
  lean: SiteKey | null;
  /** Rounded percentages (sum to 100). */
  pct: Record<SiteKey, number>;
  confidence: number;
  level: ConfidenceLevel;
  samples: number;
}
export interface ReadView { attack: TendencyView; defense: TendencyView }

export interface RevisionView {
  atMs: number; clock: string; from: CallLabel; to: CallLabel;
  /** The engine's sentence, verbatim (English). */
  reason: string;
  /** The same reason parsed for localisation (`raw` when the sentence is not recognised). */
  why: ReasonLabel;
}
export interface PlanView {
  opening: CallLabel;
  final: CallLabel;
  /** The final call differs from the opening call. */
  changed: boolean;
  objective: string | null;
  feint: string | null;
  revisions: RevisionView[];
}

/** How the opening call relates to the read the team held. */
export type Stance =
  | { kind: 'with' | 'against'; site: SiteKey; predicted: SiteKey }
  | { kind: 'neutral' };

/** The used read against what the round showed. */
export type ReadCheck =
  | { result: 'hit' | 'miss'; predicted: SiteKey; actual: SiteKey; evidence: 'plant' | 'contact' | 'defenders' }
  | { result: 'untested'; predicted: SiteKey };

/** What this team could observe of its opponent this round (what its model learns from). */
export type Learned =
  | { kind: 'plant'; site: SiteKey }
  | { kind: 'contact'; site: SiteKey }
  | { kind: 'defenders'; met: Record<SiteKey, number> }
  | { kind: 'nothing' };

export interface TeamNote {
  team: TeamSlot;
  side: Side;
  won: boolean;
  /** null when the engine recorded no plan for this team. */
  plan: PlanView | null;
  /** null when the team went in with no read (opponent memory off). */
  read: ReadView | null;
  /** null without a plan or without a read at medium+ confidence that leans to a site. */
  stance: Stance | null;
  /** null when the used read has no lean (no data / even split) or there is no read. */
  check: ReadCheck | null;
  learned: Learned;
}

export interface RoundNote {
  roundNumber: number;
  phase: MatchRoundSummary['phase'];
  attacker: TeamSlot;
  winner: TeamSlot;
  reason: string;
  observed: { plantSite: SiteKey | null; firstContactSite: SiteKey | null; defendersMet: Record<SiteKey, number> };
  teams: Record<TeamSlot, TeamNote>;
  /** Any team revised its plan mid-round (drives the marker on the round picker). */
  revised: boolean;
  /** Any team opened with a fake. */
  feint: boolean;
}

function tendencyView(est: TendencyEstimate, about: Side, used: boolean): TendencyView {
  const a = Math.round(est.probability.A * 100);
  const level = confidenceLevel(est.confidence);
  const diff = est.probability.A - est.probability.B;
  const lean: SiteKey | null = level === 'none' || Math.abs(diff) < EVEN_MARGIN * 2 ? null : diff > 0 ? 'A' : 'B';
  return { about, used, lean, pct: { A: a, B: 100 - a }, confidence: est.confidence, level, samples: est.samples };
}

function readView(read: OpponentRead | null, side: Side): ReadView | null {
  if (!read) return null;
  // Attacking, the team cares where the opponent DEFENDS; defending, where it ATTACKS.
  return {
    attack: tendencyView(read.attackSite, 'attack', side === 'defense'),
    defense: tendencyView(read.defenseSite, 'defense', side === 'attack'),
  };
}

function planView(plan: PlanSummary | null): PlanView | null {
  if (!plan) return null;
  return {
    opening: parseCall(plan.opening),
    final: parseCall(plan.strategy),
    changed: plan.opening !== plan.strategy,
    objective: siteOfZone(plan.objective),
    feint: siteOfZone(plan.feint),
    revisions: plan.revisions.map((r) => ({
      atMs: r.atMs, clock: formatClock(r.atMs), from: parseCall(r.from), to: parseCall(r.to), reason: r.reason, why: parseReason(r.reason),
    })),
  };
}

/** The site an OPENING call commits to, if it commits to one. */
function openingSite(opening: string): SiteKey | null {
  switch (opening) {
    case 'aExecute': case 'fakeBtoA': case 'stackA': return 'A';
    case 'bExecute': case 'fakeAtoB': case 'stackB': return 'B';
    default: return null;
  }
}

const other = (s: SiteKey): SiteKey => (s === 'A' ? 'B' : 'A');

/**
 * Did the opening call go with the read? Defending, "with" = stacking the site the
 * attack is expected on. Attacking, "with" = going at the site the defence is NOT
 * expected to be heavy on (that is how the engine weighs it). Calls that do not pick
 * a site (default, mid control, default hold) are neutral. A low-confidence read is
 * not judged at all: the engine barely tilts on it, so a match would be coincidence.
 */
function stanceOf(side: Side, plan: PlanSummary | null, used: TendencyView | null): Stance | null {
  if (!plan || !used || !used.lean || used.level === 'low') return null;
  const site = openingSite(plan.opening);
  if (!site) return { kind: 'neutral' };
  const favoured = side === 'defense' ? used.lean : other(used.lean);
  return { kind: site === favoured ? 'with' : 'against', site, predicted: used.lean };
}

function majority(met: Record<SiteKey, number>): SiteKey | null {
  return met.A === met.B ? null : met.A > met.B ? 'A' : 'B';
}

/** The used read against what the round showed (same evidence the engine's model learns from). */
function checkOf(side: Side, used: TendencyView | null, observed: RoundNote['observed']): ReadCheck | null {
  if (!used || !used.lean) return null;
  const predicted = used.lean;
  if (side === 'defense') {
    const actual = observed.plantSite ?? observed.firstContactSite;
    if (!actual) return { result: 'untested', predicted };
    return { result: actual === predicted ? 'hit' : 'miss', predicted, actual, evidence: observed.plantSite ? 'plant' : 'contact' };
  }
  const actual = majority(observed.defendersMet);
  if (!actual) return { result: 'untested', predicted };
  return { result: actual === predicted ? 'hit' : 'miss', predicted, actual, evidence: 'defenders' };
}

function learnedOf(side: Side, observed: RoundNote['observed']): Learned {
  if (side === 'attack') {
    const { A, B } = observed.defendersMet;
    return A + B > 0 ? { kind: 'defenders', met: { A, B } } : { kind: 'nothing' };
  }
  if (observed.plantSite) return { kind: 'plant', site: observed.plantSite };
  if (observed.firstContactSite) return { kind: 'contact', site: observed.firstContactSite };
  return { kind: 'nothing' };
}

function normaliseObserved(o: RoundObserved | undefined): RoundNote['observed'] {
  return {
    plantSite: o?.plantSite ?? null,
    firstContactSite: o?.firstContactSite ?? null,
    defendersMet: { A: o?.defendersMet?.A ?? 0, B: o?.defendersMet?.B ?? 0 },
  };
}

/** One round's analyst note, or null when the engine recorded no decisions for it. */
export function roundNote(round: MatchRoundSummary): RoundNote | null {
  const d = round.decisions;
  if (!d) return null;
  const observed = normaliseObserved(d.observed);
  const note = (team: TeamSlot): TeamNote => {
    const side: Side = round.attacker === team ? 'attack' : 'defense';
    const plan = d.plans?.[team] ?? null;
    const read = readView(d.opponentReadBefore?.[team] ?? null, side);
    const used = read ? (side === 'attack' ? read.defense : read.attack) : null;
    return {
      team, side, won: round.winner === team,
      plan: planView(plan), read,
      stance: stanceOf(side, plan, used),
      check: checkOf(side, used, observed),
      learned: learnedOf(side, observed),
    };
  };
  const teams = { A: note('A'), B: note('B') };
  const both = [teams.A, teams.B];
  return {
    roundNumber: round.roundNumber, phase: round.phase, attacker: round.attacker,
    winner: round.winner, reason: round.reason, observed, teams,
    revised: both.some((n) => (n.plan?.revisions.length ?? 0) > 0),
    feint: both.some((n) => n.plan?.feint != null),
  };
}

/** Notes for every round that has decisions (rounds without are skipped). */
export function matchNotes(match: MatchSummary): RoundNote[] {
  return match.rounds.map(roundNote).filter((n): n is RoundNote => n !== null);
}

// ── match-level summary: "did they adapt to us?" ────────────────────────────
export interface AdaptationSummary {
  rounds: number;
  /** Rounds in which the team changed its plan mid-round, and the total number of changes. */
  revisedRounds: number;
  revisions: number;
  feints: number;
  /** Rounds the team went in with a read it could act on (a lean at medium+ confidence). */
  readRounds: number;
  /** Of those, openings that went with / against the read (the rest picked no site). */
  withRead: number;
  againstRead: number;
  /** Reads the round could confirm or refute, and how many it confirmed. */
  readTested: number;
  readHits: number;
}

export function adaptationSummary(notes: RoundNote[], team: TeamSlot): AdaptationSummary {
  const s: AdaptationSummary = {
    rounds: notes.length, revisedRounds: 0, revisions: 0, feints: 0,
    readRounds: 0, withRead: 0, againstRead: 0, readTested: 0, readHits: 0,
  };
  for (const n of notes) {
    const t = n.teams[team];
    const revs = t.plan?.revisions.length ?? 0;
    if (revs > 0) s.revisedRounds += 1;
    s.revisions += revs;
    if (t.plan?.feint != null) s.feints += 1;
    if (t.stance) s.readRounds += 1;
    if (t.stance?.kind === 'with') s.withRead += 1;
    if (t.stance?.kind === 'against') s.againstRead += 1;
    if (t.check && t.check.result !== 'untested') { s.readTested += 1; if (t.check.result === 'hit') s.readHits += 1; }
  }
  return s;
}
