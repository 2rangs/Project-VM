/**
 * Map mastery — how complete a team is on one map (docs/SERIES_AND_VETO.md §3,
 * docs/STAT_OUTCOME_MATRIX.md §8).
 *
 *     M = 0.5·H + 0.3·C + 0.2·F                         each component in [0,1]
 *
 *   H  history     the team's record on the map: experience × results, both shrunk
 *   C  continuity  how much of today's five has played the map together (pairwise)
 *   F  comp fit    whether the roster has players for an established comp of the map
 *
 * Mastery is NOT a win-probability bonus. `masteryEngineInputs` turns the distance from the
 * league's typical mastery into per-team VALUES for formulas the engine already has: the throw
 * hazard, round-form σ, the trading / gameSense ratings behind the info and crossfire formulas,
 * and the pattern recognition behind the opponent model. A team at the league reference gets
 * exactly the default values, so an average series game is an ordinary `runMatch`.
 */
import {
  getAgent,
  getAgentPool,
  getMapComps,
  getPlayer,
  getTeam,
  getTeamMapRecords,
  listSimulatableTeams,
  normalizeAgentSlug,
  type MapCompData,
  type TeamMapRecord,
} from "@pv/game-data";
import type { TeamMatchInputs } from "./team-inputs.js";

/** Every constant of the mastery model, named. Design values unless marked as data. */
export const MASTERY_MODEL = {
  /** Component weights (sum to 1). */
  weights: { history: 0.5, continuity: 0.3, compFit: 0.2 },
  /** Results shrinkage: pseudo-games pulling a map's win rate toward the team's all-map rate. */
  resultsPseudoGames: 10,
  /** Pseudo-games pulling the team's all-map win rate toward 0.5. */
  overallPseudoGames: 20,
  /** Floor for the experience half-point K_E (the league median of games on a played map). */
  minExperienceHalfGames: 3,
  /** Games a PAIR needs together on a map to be half-familiar (K_C). */
  pairHalfGames: 3,
  /** Comp fit: how well a player covers an agent. */
  fit: { poolAndRole: 1, poolOffRole: 0.8, roleOnly: 0.5, neither: 0.15, unknownPlayer: 0.5, genericRole: 0.75 },
  /** A comp counts as established on a map with at least this many team-maps. */
  establishedCompMaps: 8,
  /** Pseudo-maps pulling a comp's win rate toward 0.5. */
  compPseudoMaps: 20,
  /** Uncertainty (1 sd) attached to a component when its data is missing. */
  uncertainty: { resultsUnknown: 0.15, continuityAllocated: 0.1, fitFromData: 0.05, fitGeneric: 0.15, perUnknownPlayer: 0.02 },
} as const;

/**
 * How mastery acts in play. d = M − M₀ (the league reference), clamped to ±0.5.
 * Each line is a value of an existing formula, never a result modifier.
 */
export const MASTERY_EFFECTS = {
  /** Throw hazard: λ₀' = λ₀ · exp(−throwBeta · d). Knowing the post-plant positions of a map. */
  throwBeta: 2,
  /** Round form: σ' = σ · clamp(1 − formSlope · d). Comfort removes cold rounds (and hot ones). */
  formSlope: 1.2,
  formScaleRange: [0.5, 1.6] as const,
  /** trading' = trading + tradingSlope · d → info half-life (calls precise to the spot last longer). */
  tradingSlope: 0.4,
  /** gameSense' = gameSense + gameSenseSlope · d → crossfire delay (knowing where the second gun is). */
  gameSenseSlope: 0.4,
  /** patternRecognition' = recognition + recognitionSlope · d → opponent-model prior α. */
  recognitionSlope: 0.6,
  maxDelta: 0.5,
} as const;

export interface MasteryRequest {
  readonly teamId: string;
  readonly map: string;
  /** Today's five (game-data player ids). Default: the first five of the game-data roster. */
  readonly lineup?: ReadonlyArray<string | null>;
  /**
   * The team's record per map. Default: game-data (`getTeamMapRecords`). A career mode passes its
   * own running record here (real history + the games simulated so far).
   */
  readonly records?: Readonly<Record<string, TeamMapRecord>>;
}

export interface MasteryComponent {
  /** 0..1. */
  readonly value: number;
  /** 1 standard deviation of the component's estimate. */
  readonly uncertainty: number;
}

export interface MapMastery {
  readonly teamId: string;
  readonly map: string;
  /** M, 0..1. */
  readonly value: number;
  readonly uncertainty: number;
  readonly history: MasteryComponent & {
    readonly games: number;
    /** null when the data has no results for the map. */
    readonly wins: number | null;
    /** E = n / (n + K_E). */
    readonly experience: number;
    /** R = 0.5 + (shrunk map win rate − shrunk all-map win rate); 0.5 when results are unknown. */
    readonly results: number;
    readonly resultsKnown: boolean;
  };
  readonly continuity: MasteryComponent & {
    /** Games each of today's five has played on the map with this team. */
    readonly playerGames: readonly number[];
    /** true when those are measured; false when allocated from roster appearance shares. */
    readonly measured: boolean;
  };
  readonly compFit: MasteryComponent & {
    /** "comps": matched against the map's established comps; "roles": no comp data, role coverage only. */
    readonly basis: "comps" | "roles";
    /** The comp the roster covers best (agents), when basis is "comps". */
    readonly bestComp: readonly string[] | null;
    /** Mean player→agent coverage of that comp (0..1). */
    readonly coverage: number;
    readonly unknownPlayers: number;
  };
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const mapKey = (m: string): string => m.trim().toLowerCase();

function recordFor(records: Readonly<Record<string, TeamMapRecord>>, map: string): TeamMapRecord | undefined {
  const k = mapKey(map);
  for (const [name, rec] of Object.entries(records)) if (mapKey(name) === k) return rec;
  return undefined;
}

/** game-data ids of a team's first five rostered players (null beyond the roster). */
export function defaultLineup(teamId: string): Array<string | null> {
  const roster = getTeam(teamId)?.roster ?? [];
  const ids = roster.map((r) => r.playerId).filter((id) => getPlayer(id) !== undefined);
  return Array.from({ length: 5 }, (_, i) => ids[i] ?? null);
}

// ------------------------------------------------------------------------------------------------
// League reference values (computed from the data once)
// ------------------------------------------------------------------------------------------------

let _experienceHalf: number | null = null;

/**
 * K_E — the number of games at which experience is 0.5: the league median of games on a map among
 * (team, map) pairs the team has played. A team with a typical record on a map sits at E = 0.5.
 */
export function experienceHalfGames(): number {
  if (_experienceHalf !== null) return _experienceHalf;
  const counts: number[] = [];
  for (const t of listSimulatableTeams()) {
    for (const rec of Object.values(getTeamMapRecords(t.teamId))) if (rec.games > 0) counts.push(rec.games);
  }
  counts.sort((a, b) => a - b);
  const median = counts.length ? counts[Math.floor(counts.length / 2)]! : MASTERY_MODEL.minExperienceHalfGames;
  _experienceHalf = Math.max(MASTERY_MODEL.minExperienceHalfGames, median);
  return _experienceHalf;
}

// ------------------------------------------------------------------------------------------------
// H — history
// ------------------------------------------------------------------------------------------------

/**
 * H = min(1, E · 2R)
 *   E = n / (n + K_E)                                         experience, saturating
 *   R = 0.5 + (p̂_map − p̂_all)                                map-specific results
 *   p̂_all = (W + κ₀/2) / (N + κ₀)                             team's all-map rate → 0.5
 *   p̂_map = (w + κ·p̂_all) / (n + κ)                          map rate → the team's own rate
 * so R − 0.5 = n/(n+κ) · (w/n − p̂_all): three games barely move it, and a strong team is not
 * "a master of every map" just because it wins everywhere (its strength is already in its
 * players' attributes). Without results in the data R = 0.5 and the uncertainty says so.
 */
function historyComponent(records: Readonly<Record<string, TeamMapRecord>>, map: string): MapMastery["history"] {
  const rec = recordFor(records, map);
  const n = rec?.games ?? 0;
  const experience = n / (n + experienceHalfGames());
  const all = Object.values(records);
  const resultsKnown = rec != null && rec.wins !== null && all.every((r) => r.wins !== null);
  let results = 0.5;
  let sdResults: number = MASTERY_MODEL.uncertainty.resultsUnknown;
  if (resultsKnown) {
    const N = all.reduce((s, r) => s + r.games, 0);
    const W = all.reduce((s, r) => s + (r.wins ?? 0), 0);
    const k0 = MASTERY_MODEL.overallPseudoGames;
    const k = MASTERY_MODEL.resultsPseudoGames;
    const pAll = (W + k0 / 2) / (N + k0);
    const pMap = ((rec!.wins ?? 0) + k * pAll) / (n + k);
    results = clamp(0.5 + (pMap - pAll), 0, 1);
    sdResults = Math.sqrt((pMap * (1 - pMap)) / (n + k + 1));
  }
  const value = Math.min(1, experience * 2 * results);
  // ∂H/∂R = 2E; the experience term is a count and carries no sampling error of its own.
  const uncertainty = Math.min(0.5, 2 * experience * sdResults);
  return { value, uncertainty, games: n, wins: rec?.wins ?? null, experience, results, resultsKnown };
}

// ------------------------------------------------------------------------------------------------
// C — continuity
// ------------------------------------------------------------------------------------------------

/**
 * C = mean over the 10 pairs (i, j) of today's five of  g_ij / (g_ij + K_C),   g_ij = min(g_i, g_j)
 *
 * g_i = games player i has played on this map WITH this team. Teamwork is pairwise (trades,
 * crossfires, who calls what), and a pair cannot have more games together than its newer member —
 * so one new player zeroes 4 of the 10 pairs and C drops by 40%, two drop it by 70%.
 *
 * When per-player per-map games are not in the data they are allocated: g_i = n · c_i with
 * c_i = (player's appearances with the team) / (most appearances of anyone on the roster) — the
 * assumption that a player's games are spread over the team's maps in proportion. A player with
 * no appearances for the team has g_i = 0.
 */
function continuityComponent(teamId: string, records: Readonly<Record<string, TeamMapRecord>>, map: string, lineup: ReadonlyArray<string | null>): MapMastery["continuity"] {
  const rec = recordFor(records, map);
  const n = rec?.games ?? 0;
  const roster = getTeam(teamId)?.roster ?? [];
  const most = roster.reduce((m, r) => Math.max(m, r.maps), 0);
  const measured = rec?.playerGames != null;
  const playerGames = Array.from({ length: 5 }, (_, i) => {
    const id = lineup[i] ?? null;
    if (id === null) return 0;
    if (measured) return rec!.playerGames![id] ?? 0;
    const appearances = roster.find((r) => r.playerId === id)?.maps ?? 0;
    return most > 0 ? n * Math.min(1, appearances / most) : 0;
  });
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < 5; i++) {
    for (let j = i + 1; j < 5; j++) {
      const g = Math.min(playerGames[i]!, playerGames[j]!);
      sum += g / (g + MASTERY_MODEL.pairHalfGames);
      pairs += 1;
    }
  }
  const value = pairs ? sum / pairs : 0;
  return { value, uncertainty: measured ? 0 : MASTERY_MODEL.uncertainty.continuityAllocated * (n > 0 ? 1 : 0), playerGames, measured };
}

// ------------------------------------------------------------------------------------------------
// F — composition fit
// ------------------------------------------------------------------------------------------------

interface PlayerFit {
  readonly known: boolean;
  readonly role: string | null;
  readonly pool: ReadonlySet<string> | null;
}

function playerFit(id: string | null): PlayerFit {
  const p = id ? getPlayer(id) : undefined;
  const pool = id ? getAgentPool(id) : null;
  const role = p?.role ? p.role.toLowerCase() : null;
  return { known: role !== null || pool !== null, role, pool: pool ? new Set(pool) : null };
}

function agentRole(agent: string, comps: MapCompData | undefined): string | null {
  const fromMap = comps?.pickRate.find((x) => normalizeAgentSlug(x.agent) === agent)?.role;
  return (fromMap ?? getAgent(agent)?.role ?? null)?.toLowerCase() ?? null;
}

function coverageOf(player: PlayerFit, agent: string, role: string | null): number {
  const f = MASTERY_MODEL.fit;
  if (!player.known) return f.unknownPlayer;
  const inPool = player.pool?.has(agent) ?? false;
  const roleMatch = role !== null && player.role === role;
  if (inPool && roleMatch) return f.poolAndRole;
  if (inPool) return f.poolOffRole;
  if (roleMatch) return f.roleOnly;
  return f.neither;
}

/** Best one-to-one assignment of five players to five slots (mean coverage); 5! = 120 orders. */
function bestAssignment(q: ReadonlyArray<ReadonlyArray<number>>): number {
  let best = 0;
  const used = [false, false, false, false, false];
  const walk = (slot: number, sum: number): void => {
    if (slot === 5) {
      best = Math.max(best, sum / 5);
      return;
    }
    for (let p = 0; p < 5; p++) {
      if (used[p]) continue;
      used[p] = true;
      walk(slot + 1, sum + q[p]![slot]!);
      used[p] = false;
    }
  };
  walk(0, 0);
  return best;
}

const GENERIC_ROLES = ["controller", "duelist", "initiator", "sentinel"] as const;

/**
 * F = max over the map's established comps c of   coverage(c) · rel(c)
 *   coverage(c) = best one-to-one assignment of the five players to the comp's five agents, mean of
 *                 1.0  plays the agent and it is their role      0.8  plays it, off-role
 *                 0.5  right role, agent not in their pool       0.15 neither     0.5 unknown player
 *   rel(c)      = shrunk win rate of c ÷ best shrunk win rate,  shrunk = (wins + κ/2) / (maps + κ)
 * A team only has to field ONE proven comp well, hence the max. Maps without comp statistics fall
 * back to role coverage alone (one controller / duelist / initiator / sentinel + a flex), valued
 * at 0.75 per covered role because the agents cannot be checked — with a larger uncertainty.
 */
function compFitComponent(map: string, lineup: ReadonlyArray<string | null>): MapMastery["compFit"] {
  const players = Array.from({ length: 5 }, (_, i) => playerFit(lineup[i] ?? null));
  const unknownPlayers = players.filter((p) => !p.known).length;
  const u = MASTERY_MODEL.uncertainty;
  const comps = getMapComps(map);
  const established = (comps?.topComps ?? []).filter((c) => c.comp.length === 5 && c.maps >= MASTERY_MODEL.establishedCompMaps);
  if (comps && established.length > 0) {
    const k = MASTERY_MODEL.compPseudoMaps;
    const shrunk = established.map((c) => (c.mapWinRate * c.maps + k / 2) / (c.maps + k));
    const top = Math.max(...shrunk);
    let best = { value: -1, coverage: 0, comp: null as readonly string[] | null };
    established.forEach((c, idx) => {
      const agents = c.comp.map(normalizeAgentSlug);
      const roles = agents.map((a) => agentRole(a, comps));
      const q = players.map((p) => agents.map((a, s) => coverageOf(p, a, roles[s]!)));
      const coverage = bestAssignment(q);
      const value = coverage * (shrunk[idx]! / top);
      if (value > best.value) best = { value, coverage, comp: agents };
    });
    return { value: clamp(best.value, 0, 1), uncertainty: u.fitFromData + u.perUnknownPlayer * unknownPlayers, basis: "comps", bestComp: best.comp, coverage: best.coverage, unknownPlayers };
  }
  const f = MASTERY_MODEL.fit;
  const q = players.map((p) => [
    ...GENERIC_ROLES.map((r) => (!p.known ? f.unknownPlayer : p.role === r ? f.genericRole : f.neither)),
    p.known ? f.genericRole : f.unknownPlayer, // flex slot: anyone with a known role fills it
  ]);
  const coverage = bestAssignment(q);
  return { value: coverage, uncertainty: u.fitGeneric + u.perUnknownPlayer * unknownPlayers, basis: "roles", bestComp: null, coverage, unknownPlayers };
}

// ------------------------------------------------------------------------------------------------
// M and its application
// ------------------------------------------------------------------------------------------------

/** A team's mastery of one map, with every component and its uncertainty. Pure given the data. */
export function mapMastery(req: MasteryRequest): MapMastery {
  const records = req.records ?? getTeamMapRecords(req.teamId);
  const lineup = req.lineup ?? defaultLineup(req.teamId);
  const history = historyComponent(records, req.map);
  const continuity = continuityComponent(req.teamId, records, req.map, lineup);
  const compFit = compFitComponent(req.map, lineup);
  const w = MASTERY_MODEL.weights;
  const value = clamp(w.history * history.value + w.continuity * continuity.value + w.compFit * compFit.value, 0, 1);
  const uncertainty = Math.sqrt((w.history * history.uncertainty) ** 2 + (w.continuity * continuity.uncertainty) ** 2 + (w.compFit * compFit.uncertainty) ** 2);
  return { teamId: req.teamId, map: req.map, value, uncertainty, history, continuity, compFit };
}

const _reference = new Map<string, number>();

/**
 * M₀ — the league reference: the median mastery over every simulatable team × every map of the
 * pool. Effects are measured from here, so a typical team on a typical map plays on the engine's
 * calibrated defaults and a brand-new map is sloppier for everyone.
 */
export function leagueMasteryReference(pool: readonly string[]): number {
  const key = pool.map(mapKey).sort().join("|");
  const hit = _reference.get(key);
  if (hit !== undefined) return hit;
  const values: number[] = [];
  for (const t of listSimulatableTeams()) for (const map of pool) values.push(mapMastery({ teamId: t.teamId, map }).value);
  values.sort((a, b) => a - b);
  const ref = values.length ? values[Math.floor(values.length / 2)]! : 0.5;
  _reference.set(key, ref);
  return ref;
}

export interface MasteryApplication {
  /** d = clamp(M − M₀, ±0.5). */
  readonly delta: number;
  readonly inputs: Required<Pick<TeamMatchInputs, "throwRateScale" | "formSigmaScale" | "traitDelta" | "patternRecognitionDelta">>;
}

/**
 * Mastery → per-team values of existing formulas (MASTERY_EFFECTS). d = 0 returns the identity
 * (scales 1, deltas 0), which the match engine treats as "no input".
 */
export function masteryEngineInputs(mastery: number, reference: number): MasteryApplication {
  const e = MASTERY_EFFECTS;
  const d = clamp(mastery - reference, -e.maxDelta, e.maxDelta);
  return {
    delta: d,
    inputs: {
      throwRateScale: Math.exp(-e.throwBeta * d),
      formSigmaScale: clamp(1 - e.formSlope * d, e.formScaleRange[0], e.formScaleRange[1]),
      traitDelta: { trading: e.tradingSlope * d, gameSense: e.gameSenseSlope * d },
      patternRecognitionDelta: e.recognitionSlope * d,
    },
  };
}
