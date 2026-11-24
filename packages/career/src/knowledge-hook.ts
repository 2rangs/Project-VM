// Scouting knowledge inside career mode (docs/GENERATED_PEOPLE.md §9). Built into the career day
// loop right after the club layer (career.ts), so every career has it.
//
//   onCareerStart  initScouting for the manager's club (scouts start on the club's region)
//   onDay          Mondays: the weekly scouting step; an inbox summary when a report is on an
//                  assigned player or recommends signing
//   onMatchResult  the manager's series: every map adds knowledge of both lineups
//   onSeasonStart  the league list is refreshed; the youth trial for the region's new prospects
import type { CareerHook } from "./career/hooks.ts";
import { initScouting, scoutingOnDayMut, watchMatchMut, youthTrialMut, type ScoutReport } from "./knowledge.ts";
import type { World } from "./model.ts";
import { toScale200 } from "./scouting.ts";
import { newProspects } from "./world.ts";

function bestOf(w: World, reports: readonly ScoutReport[]): ScoutReport {
  const rank = { sign: 0, monitor: 1, pass: 2 } as const;
  return [...reports].sort((a, b) => rank[a.recommendation] - rank[b.recommendation] || b.pa[1] - a.pa[1] || a.playerId.localeCompare(b.playerId))[0]!;
}

export const scoutingCareerHook: CareerHook = {
  id: "scouting",
  order: 20,
  onCareerStart(world, ctx) {
    initScouting(world, ctx.career.userTeamId, ctx.date, ctx.career.season.teams);
    world.development ??= { version: 1, mentors: {} };
  },
  onDay(world, date, ctx) {
    const reports = scoutingOnDayMut(world, date);
    // Inbox only for news worth reading: a report on a player we asked about, or a signing tip.
    if (!reports.some((r) => r.kind === "player" || r.recommendation === "sign")) return;
    const best = bestOf(world, reports);
    const p = world.players[best.playerId];
    ctx.post({
      category: "scouting", key: "scouting.weekly", from: "scout",
      params: { n: reports.length, best: p?.handle ?? best.playerId, caLo: toScale200(best.ca[0])!, caHi: toScale200(best.ca[1])!, paLo: toScale200(best.pa[0])!, paHi: toScale200(best.pa[1])!, rec: best.recommendation },
      ref: { playerId: best.playerId, route: "scouting" },
    });
  },
  onMatchResult(world, fixture, ctx) {
    const c = ctx.career;
    if (!fixture.result || (fixture.home !== c.userTeamId && fixture.away !== c.userTeamId)) return;
    watchMatchMut(world, [...fixture.result.lineups.home, ...fixture.result.lineups.away], fixture.result.maps.length, ctx.date);
  },
  onSeasonStart(world, _season, ctx) {
    const sc = world.scouting;
    if (!sc) return;
    sc.league = [...ctx.career.season.teams].sort();
    const reports = youthTrialMut(world, newProspects(world).map((p) => p.playerId), ctx.date);
    if (reports.length === 0) return;
    const best = bestOf(world, reports);
    ctx.post({
      category: "scouting", key: "scouting.youthIntake", from: "scout",
      params: { n: reports.length, best: world.players[best.playerId]?.handle ?? best.playerId, paLo: toScale200(best.pa[0])!, paHi: toScale200(best.pa[1])! },
      ref: { playerId: best.playerId, route: "scouting" },
    });
  },
};
