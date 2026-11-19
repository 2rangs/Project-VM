/**
 * Scouting — what a team can learn about its opponent BEFORE a series, and what that knowledge is
 * allowed to do (docs/SERIES_AND_VETO.md §4).
 *
 * Source: the opponent's observable history only — compact logs of games it has played
 * (`TeamGameLog`: where its spike went down, where it was first met, where its defenders were
 * killed, who got the kills) plus its public map record. Nothing hidden (plans, calls) is read.
 *
 * A report does exactly two things:
 *   (a) it seeds the scouting team's in-match OpponentModel with pseudo-observations
 *       (`opponentPriorFromLogs`), so a scouted habit is played against from round 1 — as a
 *       belief with a confidence, which what the opponent actually does in the match overrides;
 *   (b) it gives the veto an ESTIMATE of the opponent's map mastery (`estimateOpponentMastery`).
 * The rest (round openings, dangerous players, liabilities) is information for the coach / UI;
 * the engine has no mechanism that consumes it yet, and the report says so rather than pretend.
 */
import { getPlayer } from "@pv/game-data";
import { deriveSeed, mulberry32 } from "@pv/round-simulator";
import type { OpponentPrior, SiteKey } from "@pv/team-engine";
import { observedTendencies, type MatchResult, type Side, type TeamSlot } from "./match.js";
import { rosterPlayerIds, rosterProfiles } from "./teams.js";
import type { MapMastery } from "./mastery.js";

/** Every constant of the scouting model, named. Design values (no real scouting data exists). */
export const SCOUTING_MODEL = {
  /** Most games of the opponent an analyst team can review before one series. */
  maxGamesReviewed: 8,
  /** Each game further back counts this much less (habits drift). */
  recencyPerGame: 0.85,
  /** Weight of a game on a DIFFERENT map than the one being prepared (style carries over in part). */
  crossMapWeight: 0.35,
  /** Cap on the prior's pseudo-observations ≈ the most a team can hold in-match, 1/(1 − 0.85). */
  priorCap: 6,
  /** Evidence rounds at which the prior reaches half its cap. */
  priorHalfRounds: 12,
  /** Uptake: how much of a report a roster carries into the match. clamp(base + slope·(dm − 0.6)). */
  uptakeBase: 0.8,
  uptakeSlope: 0.5,
  uptakeRange: [0.5, 1] as const,
  /** Pseudo-rounds shrinking a player's observed kill differential toward 0. */
  playerPseudoRounds: 24,
  /** Threat gap from the team mean that earns a "danger" / "liability" tag. */
  playerTagGap: 0.05,
  /** Mastery gap from the league reference that reads as a strong / weak map. */
  mapVerdictGap: 0.1,
} as const;

// ------------------------------------------------------------------------------------------------
// Observable game logs
// ------------------------------------------------------------------------------------------------

export interface TeamRoundLog {
  readonly round: number;
  /** The side the logged team played. */
  readonly side: Side;
  readonly won: boolean;
  readonly pistol: boolean;
  readonly buyTier: string;
  /** Attacking: where the spike was planted (public). */
  readonly plantSite: SiteKey | null;
  /** Attacking: the site of the round's first kill. */
  readonly firstContactSite: SiteKey | null;
  /** Defending: how many of the team's defenders were killed on each site. */
  readonly defendersMet: Readonly<Partial<Record<SiteKey, number>>>;
  /** Time of the round's first kill (ms into the round), or null. */
  readonly firstContactMs: number | null;
}

export interface PlayerGameLine {
  /** game-data player id, or null when the roster slot has no known player. */
  readonly playerId: string | null;
  readonly kills: number;
  readonly deaths: number;
  /** Rounds in which this player got / gave up the first kill. */
  readonly firstKills: number;
  readonly firstDeaths: number;
}

/** One game of one team, reduced to what a spectator could note down. Serializable. */
export interface TeamGameLog {
  readonly teamId: string;
  readonly opponentId: string;
  readonly map: string;
  readonly won: boolean;
  readonly score: { readonly own: number; readonly opponent: number };
  readonly rounds: readonly TeamRoundLog[];
  readonly players: readonly PlayerGameLine[];
}

/** Reduce a finished match to the observable log of the team in `slot`. */
export function teamGameLog(result: MatchResult, slot: TeamSlot): TeamGameLog {
  const opp: TeamSlot = slot === "A" ? "B" : "A";
  const ref = slot === "A" ? result.config.teamA : result.config.teamB;
  const oppRef = slot === "A" ? result.config.teamB : result.config.teamA;
  const ids = rosterPlayerIds(ref.id, 5);
  const lines = ids.map((playerId) => ({ playerId, kills: 0, deaths: 0, firstKills: 0, firstDeaths: 0 }));
  const rounds: TeamRoundLog[] = [];
  for (const r of result.rounds) {
    const side: Side = r.attacker === slot ? "attack" : "defense";
    const prefix = side === "attack" ? "atk" : "def";
    const indexOf = (id: unknown): number => {
      const s = String(id ?? "");
      return s.startsWith(prefix) ? Number(s.slice(prefix.length)) - 1 : -1;
    };
    let first = true;
    let firstContactMs: number | null = null;
    for (const e of r.events) {
      if (e.kind !== "kill") continue;
      const k = indexOf(e.actor);
      const d = indexOf(e.target);
      if (k >= 0 && lines[k]) { lines[k]!.kills += 1; if (first) lines[k]!.firstKills += 1; }
      if (d >= 0 && lines[d]) { lines[d]!.deaths += 1; if (first) lines[d]!.firstDeaths += 1; }
      if (first) firstContactMs = e.elapsedMs;
      first = false;
    }
    const seen = observedTendencies(r.events);
    rounds.push({
      round: r.roundNumber,
      side,
      won: r.winner === slot,
      pistol: r.phase === "pistol",
      buyTier: r.buys[slot].tier,
      plantSite: side === "attack" ? seen.plantSite : null,
      firstContactSite: side === "attack" ? seen.firstContactSite : null,
      defendersMet: side === "defense" ? seen.defendersMet : {},
      firstContactMs,
    });
  }
  return {
    teamId: ref.id,
    opponentId: oppRef.id,
    map: result.config.map,
    won: result.winner === slot,
    score: { own: result.score[slot], opponent: result.score[opp] },
    rounds,
    players: lines,
  };
}

// ------------------------------------------------------------------------------------------------
// Tendencies → opponent-model prior
// ------------------------------------------------------------------------------------------------

/** A reviewed game and how much it counts (1 = lived through it; < 1 = second-hand, via a report). */
export interface WeightedLog {
  readonly log: TeamGameLog;
  readonly weight: number;
}

export interface SiteEvidence {
  /** Weighted evidence per site. */
  readonly counts: Readonly<Record<SiteKey, number>>;
  /** Σ counts — effective evidence rounds. */
  readonly rounds: number;
  /** counts / rounds (0.5 / 0.5 with no evidence). */
  readonly share: Readonly<Record<SiteKey, number>>;
}

const mapKey = (m: string): string => m.trim().toLowerCase();
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function evidence(a: number, b: number): SiteEvidence {
  const rounds = a + b;
  return { counts: { A: a, B: b }, rounds, share: rounds > 0 ? { A: a / rounds, B: b / rounds } : { A: 0.5, B: 0.5 } };
}

/**
 * Site evidence in `logs` for a game on `map`, most recent log LAST.
 *
 *   weight of a round = log.weight · recencyPerGame^(games ago) · (1 same map | crossMapWeight)
 *   attack round:  plant site counts 1; no plant → first-contact site counts 0.5
 *   defense round: one observation split by where the team's defenders were met
 * — the same reading of a round that the in-match OpponentModel uses (observeRound).
 */
export function siteEvidence(logs: readonly WeightedLog[], map: string | null): { readonly attackSite: SiteEvidence; readonly defenseSite: SiteEvidence } {
  const m = SCOUTING_MODEL;
  const atk = { A: 0, B: 0 };
  const def = { A: 0, B: 0 };
  logs.forEach(({ log, weight }, i) => {
    const age = logs.length - 1 - i;
    const w = weight * m.recencyPerGame ** age * (map === null || mapKey(log.map) === mapKey(map) ? 1 : m.crossMapWeight);
    if (w <= 0) return;
    for (const r of log.rounds) {
      if (r.side === "attack") {
        if (r.plantSite) atk[r.plantSite] += w;
        else if (r.firstContactSite) atk[r.firstContactSite] += 0.5 * w;
      } else {
        const total = (r.defendersMet.A ?? 0) + (r.defendersMet.B ?? 0);
        if (total > 0) {
          def.A += (w * (r.defendersMet.A ?? 0)) / total;
          def.B += (w * (r.defendersMet.B ?? 0)) / total;
        }
      }
    }
  });
  return { attackSite: evidence(atk.A, atk.B), defenseSite: evidence(def.A, def.B) };
}

/**
 * Evidence → pseudo-observations for the OpponentModel:
 *
 *     mass   = priorCap · N / (N + priorHalfRounds)          N = effective evidence rounds
 *     seed_k = mass · share_k
 *
 * The mass saturates at `priorCap` (≈ the 6.7 observations a team can hold in-match with a 0.85
 * decay), so no amount of film makes a report worth more than having played them — and a thin
 * file gives a thin prior. In the model the confidence is then mass / (mass + 2α) as for any
 * evidence; the seed fades by 0.85 with each round actually observed.
 */
export function opponentPriorFromLogs(logs: readonly WeightedLog[], map: string): OpponentPrior | undefined {
  const m = SCOUTING_MODEL;
  const ev = siteEvidence(logs, map);
  const seed = (e: SiteEvidence): Partial<Record<SiteKey, number>> | undefined => {
    if (e.rounds <= 0) return undefined;
    const mass = (m.priorCap * e.rounds) / (e.rounds + m.priorHalfRounds);
    return { A: mass * e.share.A, B: mass * e.share.B };
  };
  const attackSite = seed(ev.attackSite);
  const defenseSite = seed(ev.defenseSite);
  if (!attackSite && !defenseSite) return undefined;
  return { ...(attackSite ? { attackSite } : {}), ...(defenseSite ? { defenseSite } : {}) };
}

// ------------------------------------------------------------------------------------------------
// Scouting quality
// ------------------------------------------------------------------------------------------------

export interface ScoutingQuality {
  /** Staff / analyst quality, 0..1 (pre-match option). */
  readonly analyst: number;
  /** Games reviewed of the games available. */
  readonly gamesReviewed: number;
  readonly gamesAvailable: number;
  /** How much of the report the roster carries into the match (from its decision-making). */
  readonly uptake: number;
}

/** Roster uptake: clamp(0.8 + 0.5·(mean decisionMaking − 0.6), 0.5, 1). */
export function rosterUptake(teamId: string): number {
  const m = SCOUTING_MODEL;
  const profiles = rosterProfiles(teamId, 5);
  const dm = profiles.reduce((s, p) => s + p.decisionMaking, 0) / Math.max(1, profiles.length);
  return clamp(m.uptakeBase + m.uptakeSlope * (dm - 0.6), m.uptakeRange[0], m.uptakeRange[1]);
}

/** Games an analyst team of this quality gets through: ceil(analyst · min(available, max)). */
export function gamesReviewed(analyst: number, available: number): number {
  return Math.ceil(clamp(analyst, 0, 1) * Math.min(available, SCOUTING_MODEL.maxGamesReviewed));
}

// ------------------------------------------------------------------------------------------------
// Opponent map mastery as the scouting team sees it
// ------------------------------------------------------------------------------------------------

/**
 * M̂ = M₀ + a·(M − M₀) + (1 − a)·u·z
 *   a = analyst quality, M = the opponent's mastery from its public record, u = that mastery's
 *   own uncertainty, z ~ N(0,1) clamped to ±2 (seeded per scouting team and map).
 * No analysts (a = 0, or scouting off) → every opponent map looks league-average.
 */
export function estimateOpponentMastery(mastery: MapMastery, reference: number, analyst: number, seed: number): number {
  const a = clamp(analyst, 0, 1);
  const rng = mulberry32(deriveSeed(seed, `scout:${mastery.teamId}:${mapKey(mastery.map)}`));
  const u1 = rng();
  const u2 = rng();
  const z = clamp(Math.sqrt(-2 * Math.log(Math.max(u1, 1e-12))) * Math.cos(2 * Math.PI * u2), -2, 2);
  return clamp(reference + a * (mastery.value - reference) + (1 - a) * mastery.uncertainty * z, 0, 1);
}

// ------------------------------------------------------------------------------------------------
// The report
// ------------------------------------------------------------------------------------------------

export interface ScoutedMap {
  readonly map: string;
  /** M̂ — the scouting team's estimate of the opponent's mastery. */
  readonly estimatedMastery: number;
  readonly games: number;
  readonly wins: number | null;
  readonly verdict: "strong" | "average" | "weak";
  /** Site tendencies as they would be seeded for a game on this map (null with no evidence). */
  readonly prior: OpponentPrior | null;
  readonly attackSite: SiteEvidence;
  readonly defenseSite: SiteEvidence;
}

export interface ScoutedPlayer {
  readonly playerId: string | null;
  readonly handle: string | null;
  readonly role: string | null;
  /** Mean of the rated aim / reaction / crosshairPlacement / impact (league average 0.6), or null. */
  readonly rating: number | null;
  readonly rounds: number;
  readonly kills: number;
  readonly deaths: number;
  readonly firstKills: number;
  readonly firstDeaths: number;
  /** threat = (rating − 0.6) + (K − D) / (rounds + 24). */
  readonly threat: number;
  readonly tag: "danger" | "liability" | null;
}

export interface ScoutingReport {
  readonly by: string;
  readonly of: string;
  readonly quality: ScoutingQuality;
  readonly maps: readonly ScoutedMap[];
  /** How they open rounds, over the reviewed games (all maps). */
  readonly openings: {
    readonly attack: { readonly rounds: number; readonly winRate: number | null; readonly plantRate: number | null; readonly site: SiteEvidence; readonly meanFirstContactMs: number | null };
    readonly defense: { readonly rounds: number; readonly winRate: number | null; readonly site: SiteEvidence };
    readonly pistol: { readonly rounds: number; readonly winRate: number | null };
  };
  readonly players: readonly ScoutedPlayer[];
  /** The reviewed games with their uptake weight — what `opponentPriorFromLogs` is fed with. */
  readonly reviewed: readonly WeightedLog[];
}

export interface ScoutingRequest {
  /** The scouting team (game-data id). */
  readonly by: string;
  /** The opponent's id. */
  readonly of: string;
  /** The opponent's observable games, most recent LAST. */
  readonly logs: readonly TeamGameLog[];
  readonly pool: readonly string[];
  /** The opponent's mastery per pool map, from its public record. */
  readonly opponentMastery: Readonly<Record<string, MapMastery>>;
  /** League reference mastery M₀. */
  readonly reference: number;
  /** Analyst quality 0..1. */
  readonly analyst: number;
  readonly seed: number;
}

const rate = (num: number, den: number): number | null => (den > 0 ? num / den : null);

function ratingOf(playerId: string | null): number | null {
  const p = playerId ? getPlayer(playerId) : undefined;
  if (!p?.hasRatings) return null;
  const attrs = p.attributes as Record<string, { value?: number | null } | undefined> | null;
  const vals = ["aim", "reaction", "crosshairPlacement", "impact"].map((k) => attrs?.[k]?.value).filter((v): v is number => typeof v === "number");
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
}

/** Build the report one team's staff prepares on the other. Deterministic given the request. */
export function buildScoutingReport(req: ScoutingRequest): ScoutingReport {
  const m = SCOUTING_MODEL;
  const analyst = clamp(req.analyst, 0, 1);
  const reviewedCount = gamesReviewed(analyst, req.logs.length);
  const uptake = rosterUptake(req.by);
  const reviewedLogs = reviewedCount > 0 ? req.logs.slice(-reviewedCount) : [];
  const reviewed: WeightedLog[] = reviewedLogs.map((log) => ({ log, weight: uptake }));

  const maps: ScoutedMap[] = req.pool.map((map) => {
    const mastery = req.opponentMastery[map];
    const estimatedMastery = mastery ? estimateOpponentMastery(mastery, req.reference, analyst, req.seed) : req.reference;
    const ev = siteEvidence(reviewed, map);
    const gap = estimatedMastery - req.reference;
    return {
      map,
      estimatedMastery,
      games: mastery?.history.games ?? 0,
      wins: mastery?.history.wins ?? null,
      verdict: gap >= m.mapVerdictGap ? "strong" : gap <= -m.mapVerdictGap ? "weak" : "average",
      prior: opponentPriorFromLogs(reviewed, map) ?? null,
      attackSite: ev.attackSite,
      defenseSite: ev.defenseSite,
    };
  });

  // --- how they open rounds (raw, unweighted counts over the reviewed games) ---
  const unit: WeightedLog[] = reviewedLogs.map((log) => ({ log, weight: 1 }));
  const flat = siteEvidence(unit.map((u) => ({ ...u, weight: 1 })), null);
  let atkRounds = 0, atkWon = 0, plants = 0, defRounds = 0, defWon = 0, pistols = 0, pistolsWon = 0, contactSum = 0, contactN = 0;
  for (const log of reviewedLogs) {
    for (const r of log.rounds) {
      if (r.side === "attack") {
        atkRounds += 1;
        if (r.won) atkWon += 1;
        if (r.plantSite) plants += 1;
        if (r.firstContactMs !== null) { contactSum += r.firstContactMs; contactN += 1; }
      } else {
        defRounds += 1;
        if (r.won) defWon += 1;
      }
      if (r.pistol) { pistols += 1; if (r.won) pistolsWon += 1; }
    }
  }

  // --- players ---
  const byPlayer = new Map<string, { playerId: string | null; rounds: number; kills: number; deaths: number; firstKills: number; firstDeaths: number }>();
  for (const log of reviewedLogs) {
    log.players.forEach((line, i) => {
      const key = line.playerId ?? `slot${i}`;
      const acc = byPlayer.get(key) ?? { playerId: line.playerId, rounds: 0, kills: 0, deaths: 0, firstKills: 0, firstDeaths: 0 };
      acc.rounds += log.rounds.length;
      acc.kills += line.kills;
      acc.deaths += line.deaths;
      acc.firstKills += line.firstKills;
      acc.firstDeaths += line.firstDeaths;
      byPlayer.set(key, acc);
    });
  }
  if (byPlayer.size === 0) {
    rosterPlayerIds(req.of, 5).forEach((playerId, i) => byPlayer.set(playerId ?? `slot${i}`, { playerId, rounds: 0, kills: 0, deaths: 0, firstKills: 0, firstDeaths: 0 }));
  }
  const scored = [...byPlayer.values()].map((p) => {
    const rating = ratingOf(p.playerId);
    const threat = ((rating ?? 0.6) - 0.6) + (p.kills - p.deaths) / (p.rounds + m.playerPseudoRounds);
    return { ...p, rating, threat };
  });
  const meanThreat = scored.reduce((s, p) => s + p.threat, 0) / Math.max(1, scored.length);
  const top = scored.reduce((a, b) => (b.threat > a.threat ? b : a), scored[0]!);
  const bottom = scored.reduce((a, b) => (b.threat < a.threat ? b : a), scored[0]!);
  const players: ScoutedPlayer[] = scored.map((p) => {
    const info = p.playerId ? getPlayer(p.playerId) : undefined;
    const tag = p === top && p.threat - meanThreat >= m.playerTagGap ? "danger" : p === bottom && meanThreat - p.threat >= m.playerTagGap ? "liability" : null;
    return { playerId: p.playerId, handle: info?.handle ?? null, role: info?.role ?? null, rating: p.rating, rounds: p.rounds, kills: p.kills, deaths: p.deaths, firstKills: p.firstKills, firstDeaths: p.firstDeaths, threat: p.threat, tag };
  });

  return {
    by: req.by,
    of: req.of,
    quality: { analyst, gamesReviewed: reviewedCount, gamesAvailable: req.logs.length, uptake },
    maps,
    openings: {
      attack: { rounds: atkRounds, winRate: rate(atkWon, atkRounds), plantRate: rate(plants, atkRounds), site: flat.attackSite, meanFirstContactMs: contactN ? contactSum / contactN : null },
      defense: { rounds: defRounds, winRate: rate(defWon, defRounds), site: flat.defenseSite },
      pistol: { rounds: pistols, winRate: rate(pistolsWon, pistols) },
    },
    players,
    reviewed,
  };
}
