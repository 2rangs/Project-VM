// The circuit's day-end bookkeeping and its news: a competition that finishes awards Champions
// Points, the next competitions are drawn (the next regional stages, then the international events
// with their qualifiers), and the manager's inbox hears about what matters to them — their own
// stages and qualification, the points race, international draws and results, and upsets.
import { REGIONS } from "../regions.ts";
import { postInbox } from "./inbox.ts";
import {
  award, CIRCUIT_MODEL, drawEvent, eventDone, eventGroupsDone, eventGroupTable, eventOf, eventPlacings, eventStart,
  isIntl, leaguesOf, qualifiers, regionRanking, allFixtures, INTL_EVENTS, pointsFor,
} from "./circuit.ts";
import {
  drawNextStage, groupStageDone, groupStandings, GROUPS, stageDone, stagePlacings, STAGES, teamStrength,
} from "./schedule.ts";
import type { CareerState, CompetitionId, Fixture, IntlEvent, IntlId, SeasonState, StageId } from "./types.ts";

/**
 * A knockout winner this much weaker (team strength, 0..1) than the loser is an upset: about 1.6 sd
 * of the strength gap between two teams of one league (sd 0.05), so a handful a season, not every
 * round.
 */
export const UPSET_GAP = 0.08;

const teamName = (s: CareerState, id: string | null | undefined): string => (id ? s.world.teams[id]?.name ?? id : "?");
const done = (s: CareerState, key: string): boolean => s.circuit.done.includes(key);
const mark = (s: CareerState, key: string): void => { if (!s.circuit.done.includes(key)) s.circuit.done.push(key); };
const userLeague = (s: CareerState): SeasonState => s.season;

/** The competition before `id` in the calendar and the competitions that gate it. */
const NEXT_STAGE: Partial<Record<StageId, StageId>> = { kickoff: "stage1", stage1: "stage2" };

function userRegionRank(s: CareerState): number {
  const l = userLeague(s);
  return regionRanking(s.world, s.circuit, l.region, l.teams).indexOf(s.userTeamId) + 1;
}

// --- news -------------------------------------------------------------------------------------------

/** After a result: an upset in a knockout or international match is news. */
export function upsetNews(s: CareerState, f: Fixture): void {
  if (!f.result || !f.home || !f.away) return;
  if (f.phase !== "playoff") return; // group matches are not news
  if (!isIntl(f.stage) && f.region !== s.region) return; // other regions' playoffs are not news
  const loser = f.result.winner === f.home ? f.away : f.home;
  const gap = teamStrength(s.world, loser) - teamStrength(s.world, f.result.winner);
  if (gap < UPSET_GAP) return;
  if (f.home === s.userTeamId || f.away === s.userTeamId) return; // our own result has its own mail
  postInbox(s, {
    category: "competition", key: "circuit.upset", from: "league",
    params: { winner: teamName(s, f.result.winner), loser: teamName(s, loser), score: `${f.result.mapsWon[f.home === f.result.winner ? 0 : 1]}–${f.result.mapsWon[f.home === f.result.winner ? 1 : 0]}`, stage: f.stage, round: String(f.round) },
    ref: { fixtureId: f.id },
  });
}

function userNextFixture(s: CareerState): Fixture | null {
  return allFixtures(s).filter((f) => !f.result && f.home && f.away && (f.home === s.userTeamId || f.away === s.userTeamId) && f.date >= s.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id.localeCompare(b.id)))[0] ?? null;
}

function opponentName(s: CareerState, f: Fixture | null): string {
  return f ? teamName(s, f.home === s.userTeamId ? f.away : f.home) : "";
}

// --- regional stages -----------------------------------------------------------------------------------

function regionalStageDone(s: CareerState, league: SeasonState, stage: StageId): void {
  const key = `${stage}:${league.region}`;
  if (done(s, key) || !stageDone(league, stage)) return;
  mark(s, key);
  const placings = stagePlacings(league, stage);
  league.stages.find((x) => x.id === stage)!.champion = placings[0]!;
  award(s.circuit, stage, placings, s.world);
  if (league === userLeague(s)) {
    postInbox(s, { category: "competition", key: "competition.champion", from: "league", params: { stage, team: teamName(s, placings[0]), place: placings.indexOf(s.userTeamId) + 1 } });
  }
}

/** The manager's own group stage just ended: through to the playoffs or not. */
function userGroupNews(s: CareerState): void {
  const l = userLeague(s);
  for (const stage of l.stages) {
    if (!stage.start || !groupStageDone(l, stage.id)) continue;
    const key = `groups:${stage.id}`;
    if (done(s, key)) continue;
    mark(s, key);
    const g = GROUPS.find((x) => stage.groups[x].includes(s.userTeamId));
    if (!g) continue;
    const rank = groupStandings(l, stage.id, g).findIndex((r) => r.teamId === s.userTeamId) + 1;
    postInbox(s, { category: "competition", key: rank <= 4 ? "competition.qualified" : "competition.eliminated", from: "league", params: { stage: stage.id, rank, group: g } });
  }
}

/** All four leagues finished `stage`: the points race, the next stage's draw, the next event's draw. */
function stageRoundOver(s: CareerState, stage: StageId): void {
  if (done(s, `all:${stage}`)) return;
  if (!REGIONS.every((r) => done(s, `${stage}:${r}`) || !leaguesOf(s).some((l) => l.region === r))) return;
  mark(s, `all:${stage}`);
  raceNews(s, stage);
  const next = NEXT_STAGE[stage];
  const leagues = leaguesOf(s);
  if (stage === "kickoff") {
    for (const l of leagues) drawNextStage(l, "kickoff", "stage1", s.seed);
    stageDrawnNews(s, "stage1");
  } else if (stage === "stage1") {
    const e = drawIntl(s, "masters1");
    for (const l of leagues) drawNextStage(l, "stage1", "stage2", s.seed, e.end);
    stageDrawnNews(s, "stage2");
  } else if (stage === "stage2") {
    drawIntl(s, "masters2");
  }
  void next;
}

function stageDrawnNews(s: CareerState, stage: StageId): void {
  const l = userLeague(s);
  const st = l.stages.find((x) => x.id === stage)!;
  const g = GROUPS.find((x) => st.groups[x].includes(s.userTeamId)) ?? "alpha";
  const first = userNextFixture(s);
  postInbox(s, {
    category: "competition", key: "competition.drawn", from: "league",
    params: { stage, group: g, date: first?.date ?? "", opponent: opponentName(s, first) },
    ...(first ? { ref: { fixtureId: first.id } } : {}),
  });
}

/** The points race in the manager's region after a competition: where we stand and the cut. */
function raceNews(s: CareerState, after: CompetitionId): void {
  const l = userLeague(s);
  const ranking = regionRanking(s.world, s.circuit, l.region, l.teams);
  const rank = ranking.indexOf(s.userTeamId) + 1;
  const target: IntlId = after === "kickoff" || after === "stage1" ? "masters1" : after === "stage2" || after === "masters1" ? "masters2" : "champions";
  const quota = CIRCUIT_MODEL.quota[target];
  const cut = ranking[quota - 1];
  postInbox(s, {
    category: "competition", key: "circuit.race", from: "league",
    params: {
      after, event: target, rank, points: s.circuit.points[s.userTeamId] ?? 0, quota,
      leader: teamName(s, ranking[0]), leaderPoints: s.circuit.points[ranking[0] ?? ""] ?? 0,
      cut: s.circuit.points[cut ?? ""] ?? 0, team3: teamName(s, cut),
    },
  });
}

// --- international events --------------------------------------------------------------------------------

function drawIntl(s: CareerState, id: IntlId): IntlEvent {
  const ev = eventOf(s.circuit, id);
  const leagues = leaguesOf(s);
  const { teams, qualified } = qualifiers(s.world, s.circuit, leagues, id);
  const gate = CIRCUIT_MODEL.after[id];
  const prevEnd = isIntl(gate)
    ? eventOf(s.circuit, gate as IntlId).end
    : leagues.map((l) => l.stages.find((x) => x.id === gate)?.end ?? null).filter((d): d is string => !!d).sort().pop() ?? null;
  drawEvent(ev, s.season.season, teams, qualified, eventStart(s.season.season, id, prevEnd), s.seed);
  const mine = ev.teams.includes(s.userTeamId);
  if (mine) {
    const g = Object.keys(ev.groups).find((k) => ev.groups[k]!.includes(s.userTeamId))!;
    const first = userNextFixture(s);
    postInbox(s, {
      category: "competition", key: "circuit.qualified", from: "league",
      params: {
        event: id, group: g, date: first?.date ?? ev.start ?? "", opponent: opponentName(s, first),
        mates: ev.groups[g]!.filter((t) => t !== s.userTeamId).map((t) => teamName(s, t)).join(", "),
        points: s.circuit.points[s.userTeamId] ?? 0, seed: ev.teams.indexOf(s.userTeamId) + 1, teams: ev.teams.length,
      },
      ...(first ? { ref: { fixtureId: first.id } } : {}),
    });
  } else {
    const l = userLeague(s);
    const ranking = regionRanking(s.world, s.circuit, l.region, l.teams);
    const quota = CIRCUIT_MODEL.quota[id];
    postInbox(s, {
      category: "competition", key: "circuit.missed", from: "league",
      params: {
        event: id, rank: ranking.indexOf(s.userTeamId) + 1, quota, points: s.circuit.points[s.userTeamId] ?? 0,
        cut: s.circuit.points[ranking[quota - 1] ?? ""] ?? 0, from: ev.start ?? "",
        reps: ranking.slice(0, quota).map((t) => teamName(s, t)).join(", "),
      },
    });
  }
  // The draw itself, for the whole world: who is in, the favourite by points.
  const regions = REGIONS.map((r) => ev.teams.filter((t) => s.world.teams[t]?.region === r).length).join("/");
  postInbox(s, {
    category: "competition", key: "circuit.draw", from: "league",
    params: { event: id, start: ev.start ?? "", teams: ev.teams.length, top: teamName(s, ev.teams[0]), topPoints: s.circuit.points[ev.teams[0] ?? ""] ?? 0, regions },
  });
  return ev;
}

function eventProgress(s: CareerState, ev: IntlEvent): void {
  if (!ev.start) return;
  const mine = ev.teams.includes(s.userTeamId);
  const gKey = `groups:${ev.id}`;
  if (mine && eventGroupsDone(ev) && !done(s, gKey)) {
    mark(s, gKey);
    const g = Object.keys(ev.groups).find((k) => ev.groups[k]!.includes(s.userTeamId))!;
    const rank = eventGroupTable(ev, g).findIndex((r) => r.teamId === s.userTeamId) + 1;
    postInbox(s, { category: "competition", key: rank <= 2 ? "circuit.groupsThrough" : "circuit.groupsOut", from: "league", params: { event: ev.id, rank, group: g } });
  }
  if (!eventDone(ev) || done(s, ev.id)) return;
  mark(s, ev.id);
  ev.placings = eventPlacings(ev);
  ev.champion = ev.placings[0]!;
  award(s.circuit, ev.id, ev.placings, s.world);
  const place = ev.placings.indexOf(s.userTeamId) + 1;
  postInbox(s, {
    category: "competition", key: "circuit.champion", from: "league",
    params: { event: ev.id, team: teamName(s, ev.champion), region: s.world.teams[ev.champion]?.region ?? "", runnerUp: teamName(s, ev.placings[1]), place },
  });
  if (mine) postInbox(s, { category: "competition", key: "circuit.result", from: "board", params: { event: ev.id, place, teams: ev.teams.length, points: place > 0 ? pointsFor(ev.id, place) : 0 } });
  if (ev.id === "masters1") raceNews(s, "masters1");
  if (ev.id === "masters2") { raceNews(s, "masters2"); drawIntl(s, "champions"); }
}

/** Called when the day ends (results are in): finish what finished, draw what is next, post the news. */
export function circuitProgress(s: CareerState): void {
  userGroupNews(s);
  for (const stage of STAGES) {
    for (const l of leaguesOf(s)) regionalStageDone(s, l, stage);
    stageRoundOver(s, stage);
  }
  for (const id of INTL_EVENTS) eventProgress(s, eventOf(s.circuit, id));
}
