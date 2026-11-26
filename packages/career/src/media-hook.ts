// Media and player interaction inside career mode (backlog #7). Built into the career day loop
// after the club and scouting layers, so every career has press conferences, promises and the
// weekly chemistry step. Player-initiated talks (praise/criticise/promise) come from the desktop
// (media-actions on the session), not from the loop.
//
//   onDay          Mondays: the weekly chemistry step; due promises are judged (inbox). A pre-match
//                  presser for a NOTABLE upcoming fixture (playoff / international / tough opponent).
//   onMatchResult  the manager's series: winMatch promises settle; a post-match presser for a
//                  notable result (big win / loss against expectation).
//   onSeasonEnd    open trophy promises settle (kept iff a regional title was won this season).
//   onAnswer       a press item was answered → the squad-wide morale + chemistry effect.
import type { CareerHook } from "./career/hooks.ts";
import { daysBetween, weekday } from "./career/calendar.ts";
import { teamStrength } from "./career/schedule.ts";
import type { CareerState, Fixture } from "./career/types.ts";
import type { World } from "./model.ts";
import {
  applyPressMut, chemistryWeekMut, markPressed, mediaOf, resolveDuePromisesMut, resolveMatchPromisesMut,
  resolveTrophyPromisesMut, type MediaState, type PressTopic, type ResolvedPromise,
} from "./media.ts";

const isUserFixture = (state: CareerState, f: Fixture): boolean => f.home === state.userTeamId || f.away === state.userTeamId;

/**
 * The manager's next unplayed fixture (teams known), by date. Scans ONLY the manager's own league
 * and the international events they are in — not the other three regions' leagues — so it stays
 * cheap enough to run every day (the other leagues can never hold the manager's fixtures).
 */
function nextUserFixture(state: CareerState): Fixture | null {
  let best: Fixture | null = null;
  const consider = (f: Fixture): void => {
    if (f.result || f.date < state.date || !f.home || !f.away || !isUserFixture(state, f)) return;
    if (!best || f.date < best.date || (f.date === best.date && f.id < best.id)) best = f;
  };
  for (const f of state.season.fixtures) consider(f);
  for (const e of state.circuit.events) for (const f of e.fixtures) consider(f);
  return best;
}

/** A fixture worth a press conference: a regional playoff or any international match. */
function notable(_state: CareerState, f: Fixture): boolean {
  return f.phase === "playoff" || f.stage === "masters1" || f.stage === "masters2" || f.stage === "champions";
}

function postResolved(ctx: Parameters<NonNullable<CareerHook["onDay"]>>[2], world: World, resolved: readonly ResolvedPromise[]): void {
  for (const r of resolved) {
    const p = world.players[r.promise.playerId];
    ctx.post({
      category: "squad", key: r.kept ? "media.promiseKept" : "media.promiseBroken", from: "player",
      params: { player: p?.handle ?? r.promise.playerId, kind: r.promise.kind },
      ref: { playerId: r.promise.playerId, route: "media" },
    });
  }
}

/** Won a REGIONAL title this season (any of the three stages' champion is the user's team). */
function wonRegionalTitle(state: CareerState): boolean {
  return state.season.stages.some((s) => s.champion === state.userTeamId);
}

export const mediaCareerHook: CareerHook = {
  id: "media",
  order: 30,
  onCareerStart(_world, ctx) {
    mediaOf(ctx.career); // create the ext slot so saves carry it from day one
  },
  onDay(world, date, ctx) {
    if (!world.club?.userTeamId) return;
    const m = mediaOf(ctx.career);
    if (weekday(date) === 1) {
      chemistryWeekMut(world, m);
      postResolved(ctx, world, resolveDuePromisesMut(world, m, date));
    }
    // A pre-match presser for a notable fixture within two days (asked once per fixture).
    const next = nextUserFixture(ctx.career);
    if (next && next.date > date && daysBetween(date, next.date) <= 2 && notable(ctx.career, next)) {
      if (!markPressed(m, next.id, "pre")) postPress(ctx, "preBig", { opponent: opponentName(world, ctx.career, next) }, next.id);
    }
  },
  onMatchResult(world, fixture, ctx) {
    const c = ctx.career;
    if (!world.club?.userTeamId || !fixture.result || !isUserFixture(c, fixture)) return;
    const m = mediaOf(c);
    const won = fixture.result.winner === c.userTeamId;
    postResolved(ctx, world, resolveMatchPromisesMut(world, m, won, ctx.date));
    // A post-match presser when the result is a notable one (playoff/international, or an upset).
    if (notableResult(c, fixture, won) && !markPressed(m, fixture.id, "post")) {
      postPress(ctx, won ? "afterWin" : "afterLoss", { opponent: opponentName(world, c, fixture) }, fixture.id);
    }
  },
  onSeasonEnd(world, _season, ctx) {
    if (!world.club?.userTeamId) return;
    const m = mediaOf(ctx.career);
    postResolved(ctx, world, resolveTrophyPromisesMut(world, m, wonRegionalTitle(ctx.career), ctx.date));
  },
  onAnswer(world, item, answer, ctx) {
    if (item.key.startsWith("media.press.")) {
      const topic = item.key.slice("media.press.".length) as PressTopic;
      applyPressMut(world, mediaOf(ctx.career), topic, answer, ctx.date);
    }
  },
};

function opponentName(world: World, state: CareerState, f: Fixture): string {
  const opp = f.home === state.userTeamId ? f.away : f.home;
  return (opp && world.teams[opp]?.name) || "?";
}

/** A result worth reacting to: a playoff/international match, or an upset either way. */
function notableResult(state: CareerState, f: Fixture, won: boolean): boolean {
  if (f.phase === "playoff" || f.stage === "masters1" || f.stage === "masters2" || f.stage === "champions") return true;
  const opp = f.home === state.userTeamId ? f.away : f.home;
  if (!opp) return false;
  const gap = teamStrength(state.world, state.userTeamId) - teamStrength(state.world, opp);
  // Beating a clearly stronger team, or losing to a clearly weaker one.
  return (won && gap <= -0.04) || (!won && gap >= 0.04);
}

function postPress(ctx: Parameters<NonNullable<CareerHook["onDay"]>>[2], topic: PressTopic, params: Record<string, string | number>, fixtureId: string): void {
  const opts = (topic === "preBig" ? ["confident", "measured", "deflect"] : topic === "afterWin" ? ["praiseTeam", "stayGrounded", "lookAhead"] : ["backThem", "takeBlame", "criticise"]);
  ctx.post({
    category: "squad", key: `media.press.${topic}`, from: "media", params,
    options: opts.map((id) => ({ id })),
    ref: { fixtureId, route: "media" },
  });
}
