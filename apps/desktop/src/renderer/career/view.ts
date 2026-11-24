// Pure helpers between the career state and the screens (no React): labels, the manager's
// series as a career fixture and back, inbox text. Unit-tested in test/career-mode.test.ts.
import type { SeriesView } from '../../shared/series.ts';
import type { SimRosterPlayer } from '../../shared/career.ts';
import {
  isUserFixture, lineupFor, matchRoster, teamStaffInputs, seriesRequest,
  type CareerState, type Fixture, type InboxItem, type SeriesOutcome,
} from './world.ts';

type T = (key: string, vars?: Record<string, string | number>) => string;

export const teamName = (c: CareerState, id: string | null | undefined): string => (id ? c.world.teams[id]?.name ?? id : '?');

/** The other team of a fixture from the manager's side (null while a playoff slot is open). */
export function opponentOf(c: CareerState, f: Fixture): string | null {
  return f.home === c.userTeamId ? f.away : f.away === c.userTeamId ? f.home : null;
}

/** "Stage 1 · Group Alpha · Round 2" / "Stage 1 · Playoffs · Final". */
export function fixtureLabel(t: T, f: Fixture): string {
  const stage = t(`career.enum.${f.stage}`);
  const g = f.group && /^[a-d]$/.test(f.group) ? f.group.toUpperCase() : t(`career.enum.${f.group}`);
  if (f.phase === 'group') return `${stage} · ${t('career.group', { g })} · ${t('career.round', { n: f.round })}`;
  return `${stage} · ${t('career.playoffs')} · ${t(`career.enum.${f.round}`)}`;
}

/** Score from the manager's side, e.g. "2–1" (null before it is played). */
export function userScore(c: CareerState, f: Fixture): { text: string; won: boolean } | null {
  if (!f.result) return null;
  const home = f.home === c.userTeamId;
  const [a, b] = home ? f.result.mapsWon : [f.result.mapsWon[1], f.result.mapsWon[0]];
  return { text: `${a}–${b}`, won: f.result.winner === c.userTeamId };
}

/** Today's five for the match: the manager's lineup / roster order, readiness applied. */
const rosterOf = (c: CareerState, teamId: string): SimRosterPlayer[] => matchRoster(c, lineupFor(c, teamId));
const practiceOf = (c: CareerState, teamId: string) => c.world.club?.training.mapPractice[teamId] ?? {};

/** Everything the series screen needs to play the manager's fixture with the career's teams. */
export function seriesSetup(c: CareerState, f: Fixture) {
  if (!isUserFixture(c, f)) throw new Error(`${f.id} is not the manager's fixture`);
  const opp = opponentOf(c, f)!;
  const req = seriesRequest(c, f);
  return {
    teamA: { id: c.userTeamId, name: teamName(c, c.userTeamId) },
    teamB: { id: opp, name: teamName(c, opp) },
    format: f.format,
    seed: req.seed,
    analyst: teamStaffInputs(c.world, c.userTeamId).analyst,
    rosters: { A: rosterOf(c, c.userTeamId), B: rosterOf(c, opp) },
    practice: { A: practiceOf(c, c.userTeamId), B: practiceOf(c, opp) },
  };
}

/** A finished series (our team = series team A) as the fixture's result, home/away as scheduled. */
export function outcomeFromSeries(c: CareerState, f: Fixture, view: SeriesView): SeriesOutcome {
  if (!view.winner) throw new Error('the series is not finished');
  const userHome = f.home === c.userTeamId;
  const opp = opponentOf(c, f)!;
  const orient = (a: number, b: number): [number, number] => (userHome ? [a, b] : [b, a]);
  const lineups = { user: lineupFor(c, c.userTeamId), opp: lineupFor(c, opp) };
  return {
    winner: view.winner === 'A' ? c.userTeamId : opp,
    mapsWon: orient(view.score.A, view.score.B),
    // Per-player kills/deaths from the engine (series-session) → form and the season line.
    maps: view.games.map((g) => ({ map: g.map, score: orient(g.score.A, g.score.B), ...(g.overtime ? { overtime: true } : {}), ...(g.players ? { players: g.players } : {}) })),
    source: 'user',
    lineups: userHome ? { home: lineups.user, away: lineups.opp } : { home: lineups.opp, away: lineups.user },
  };
}

/** An inbox item's title/body in the active language (string keys, else the item's own text). */
export function inboxText(t: T, lang: 'ko' | 'en', m: InboxItem): { title: string; body: string } {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(m.params)) {
    if (typeof v === 'string') {
      const key = `career.enum.${v}`;
      const tr = t(key);
      params[k] = tr === key ? v : tr;
    } else params[k] = v;
  }
  const tk = `inbox.${m.key}.title`;
  const title = t(tk, params);
  if (title !== tk) {
    const bk = `inbox.${m.key}.body`;
    const body = t(bk, params);
    return { title, body: body === bk ? '' : body };
  }
  const own = m.text?.[lang] ?? m.text?.en;
  return { title: own?.title ?? m.key, body: own?.body ?? '' };
}

export function optionLabel(t: T, lang: 'ko' | 'en', m: InboxItem, id: string): string {
  const k = `inbox.${m.key}.option.${id}`;
  const v = t(k);
  if (v !== k) return v;
  return m.options?.find((o) => o.id === id)?.label?.[lang] ?? id;
}

/** Fixtures grouped by month ("2026-02") for the schedule view. */
export function fixturesByMonth(fixtures: readonly Fixture[]): Map<string, Fixture[]> {
  const out = new Map<string, Fixture[]>();
  for (const f of fixtures) {
    const k = f.date.slice(0, 7);
    if (!out.has(k)) out.set(k, []);
    out.get(k)!.push(f);
  }
  return out;
}
