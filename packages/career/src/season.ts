// Season flow: `advanceSeason(world)` ends the current season and opens the next one.
//
//   1. development / decline   every player and staff member, from the season just played
//                              (playing time by status, the team's head coach)
//   2. aging                   everyone +1 year
//   3. retirement              age × situation hazard (docs/GENERATED_PEOPLE.md §4)
//   4. staff                   vacancies filled from the free staff pool; staff intake tops the
//                              pool back up to its target
//   5. player intake           new generated prospects per region, sized so each region's
//                              population returns to its target
//   6. academies               each team's scout picks the prospects it rates highest
//   7. squads                  rosters re-sorted by ability; academy players promoted when better;
//                              short rosters sign the best free agents (by scout estimate)
//
// Pure: returns a new World, the input is untouched. Deterministic: every draw comes from a stream
// derived from (world.seed, season, person id), so the result does not depend on iteration order.
import { CAREER_MODEL, closingRate, coachFactor, declineLoss, playTimeFactor, uncertaintyAfter } from "./ability.ts";
import { compositeOf } from "./calibration.ts";
import { generatePlayer, generateStaff, staffQuality, STAFF_MODEL } from "./generate.ts";
import {
  ABILITY_KEYS, STAFF_ROLES,
  type AbilityKey, type RatedAttr, type SeasonRecord, type StaffRole, type World, type WorldPlayer, type WorldStaff, type WorldTeam,
} from "./model.ts";
import { REGIONS, type Region } from "./regions.ts";
import { estimateAbility, teamScout, UNRATED_ABILITY } from "./scouting.ts";
import { clamp, normal, streamFor, weightedIndex } from "./rng.ts";

export const SEASON_MODEL = {
  /** Starters per team (the five who play). */
  starters: 5,
  /** Most players a main roster carries; the weakest beyond it are released. */
  maxRoster: 8,
  /** Academy places per team, and the age an academy player must be promoted by or released at. */
  academySize: 3,
  academyMaxAge: 21,
  /** Promote an academy player when the scout rates them this much above the weakest starter. */
  promotionMargin: 0.01,
  /** Minimum intake per region each season, as a share of the region's target population. */
  minIntakeShare: 0.03,
  // Retirement hazard h(t) = 1 / (1 + exp(−(t − A50) / s)).
  /** A50 for a player under contract (main roster). */
  retireAgeSigned: 31,
  /** A50 for an unsigned player (free / academy): A50 = base + span · v, v = (CA − caMin)/(caMax − caMin). */
  retireAgeUnsignedBase: 22,
  retireAgeUnsignedSpan: 9,
  retireSlope: 1.5,
  /** Staff: A50 = staffRetireAge when employed; base + span · quality when not. */
  staffRetireAge: 62,
  staffRetireUnemployedBase: 38,
  staffRetireUnemployedSpan: 22,
  staffRetireSlope: 3,
  /** Free staff kept in the pool, per team and role. */
  freeStaffPerTeamRole: 0.5,
  /** Agent pool target: pool grows by one per season while smaller than base + careerMaps / mapsPerAgent. */
  agentPoolBase: 3,
  mapsPerAgent: 80,
  agentPoolMax: 10,
} as const;

const r4 = (v: number): number => Math.round(v * 10000) / 10000;
const hazard = (t: number, a50: number, s: number): number => 1 / (1 + Math.exp(-(t - a50) / s));

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

const sortedTeams = (w: World): WorldTeam[] => Object.values(w.teams).sort((a, b) => a.teamId.localeCompare(b.teamId));

/** True ability used for squad ordering when a player has no rating. */
const abilityOf = (p: WorldPlayer): number => p.ca ?? UNRATED_ABILITY;

/** Maps a player plays in a season, by status (top five of a roster start). */
export function seasonMaps(w: World, p: WorldPlayer): number {
  const m = CAREER_MODEL;
  if (p.status === "free" || !p.teamId) return m.mapsFree;
  if (p.status === "academy") return m.mapsAcademy;
  const roster = w.teams[p.teamId]?.roster ?? [];
  return roster.indexOf(p.playerId) < SEASON_MODEL.starters ? m.mapsStarter : m.mapsBench;
}

function coachDevelopment(w: World, teamId: string | null): number {
  if (!teamId) return 0;
  const id = w.teams[teamId]?.staff.headCoach;
  return id ? w.staff[id]?.attributes.development ?? 0 : 0;
}

// --- 1. development -------------------------------------------------------------------------------

/**
 * One season of development for a player aged t:
 *   x' = x + clamp(r(t) · P · C · F · (1 + σ·z), 0, 1) · (peak − x) − λ·max(0, t + 1 − D)
 * clamped to [real min, peak]. r = maturity-curve closing rate, P = playing time, C = coach,
 * F = training focus factor of the attribute (club/training.ts; 1 without a training plan).
 */
export function developPlayer(w: World, p: WorldPlayer, maps: number, coachDev: number, season: number, focus?: Partial<Record<AbilityKey, number>>): void {
  const cal = w.calibration;
  const attrs = p.attributes;
  if (!p.hasRatings || !attrs) return;
  const rng = streamFor(w.seed, `develop:${season}:${p.playerId}`);
  const P = playTimeFactor(maps);
  const C = coachFactor(coachDev);
  for (const k of ABILITY_KEYS) {
    const slot = attrs[k] as RatedAttr | undefined;
    if (!slot || typeof slot.value !== "number") continue;
    const peak = p.peak?.[k] ?? slot.value;
    const F = focus?.[k] ?? 1;
    const growth = clamp(closingRate(p.age, k) * P * C * F * (1 + CAREER_MODEL.developmentNoise * normal(rng)), 0, 1);
    const grown = slot.value + growth * Math.max(0, peak - slot.value);
    const next = clamp(grown - declineLoss(p.age, k), cal.min[k], Math.max(cal.min[k], peak));
    slot.value = r4(next);
  }
  p.careerMaps += maps;
  if (p.generated) {
    const u = r4(uncertaintyAfter(p.careerMaps, cal.medianUncertainty));
    for (const slot of Object.values(attrs)) if (slot.value !== null) { (slot as RatedAttr).uncertainty = u; (slot as RatedAttr).nMaps = p.careerMaps; }
  }
  p.ca = caOf(w, p);
  if (p.pa !== null && p.ca !== null && p.pa < p.ca) p.pa = p.ca;
  // Agent pool widens with experience.
  const target = Math.min(SEASON_MODEL.agentPoolMax, SEASON_MODEL.agentPoolBase + Math.floor(p.careerMaps / SEASON_MODEL.mapsPerAgent));
  if (p.role && maps > 0 && p.agentPool.length < target) {
    const freq = Object.entries(cal.agentFreq[p.role]).filter(([a]) => !p.agentPool.includes(a)).sort(([a], [b]) => a.localeCompare(b));
    if (freq.length) {
      p.agentPool.push(freq[weightedIndex(rng, freq.map(([, n]) => n))]![0]);
      p.agentPool.sort();
    }
  }
}

/** CA of a rated player: mean of the ability attributes (missing ones read as the role mean). */
export function caOf(w: Pick<World, "calibration">, p: Pick<WorldPlayer, "attributes" | "role" | "hasRatings">): number | null {
  if (!p.hasRatings || !p.attributes) return null;
  const role = p.role ?? "initiator";
  return r4(compositeOf((k) => {
    const v = (p.attributes![k] as { value?: number | null } | undefined)?.value;
    return typeof v === "number" ? v : w.calibration.roleMean[role][k];
  })!);
}

function developStaff(s: WorldStaff): void {
  const sm = STAFF_MODEL;
  for (const k of Object.keys(s.attributes)) {
    let v = s.attributes[k]!;
    if (s.age < sm.learnUntilAge) v += (sm.attrMax - v) * sm.learnRate;
    v -= sm.declinePerYear * Math.max(0, s.age + 1 - sm.declineAge);
    s.attributes[k] = r4(clamp(v, sm.attrMin, sm.attrMax));
  }
}

// --- 3. retirement --------------------------------------------------------------------------------

export function retirementHazard(w: World, p: WorldPlayer): number {
  const sm = SEASON_MODEL;
  if (p.status === "rostered") return hazard(p.age, sm.retireAgeSigned, sm.retireSlope);
  const cal = w.calibration;
  const v = clamp((abilityOf(p) - cal.caMin) / Math.max(1e-6, cal.caMax - cal.caMin), 0, 1);
  return hazard(p.age, sm.retireAgeUnsignedBase + sm.retireAgeUnsignedSpan * v, sm.retireSlope);
}

export function staffRetirementHazard(s: WorldStaff): number {
  const sm = SEASON_MODEL;
  const a50 = s.teamId ? sm.staffRetireAge : sm.staffRetireUnemployedBase + sm.staffRetireUnemployedSpan * staffQuality(s);
  return hazard(s.age, a50, sm.staffRetireSlope);
}

function detachPlayer(w: World, p: WorldPlayer): string | null {
  const from = p.teamId;
  if (from && w.teams[from]) {
    const t = w.teams[from];
    t.roster = t.roster.filter((id) => id !== p.playerId);
    t.academy = t.academy.filter((id) => id !== p.playerId);
  }
  p.teamId = null;
  p.status = "free";
  return from;
}

// --- 4–7. opening a season ------------------------------------------------------------------------

export function emptyRecord(w: World, season: number): SeasonRecord {
  return { season, newPlayers: [], newStaff: [], retiredPlayers: [], retiredStaff: [], signings: [], academyPicks: [], releases: [], hires: [], population: {} };
}

function nextId(w: World, prefix: string, season: number): string {
  const id = `${prefix}-${season}-${w.nextGenId.toString(36).padStart(4, "0")}`;
  w.nextGenId += 1;
  return id;
}

export function regionPopulation(w: World): Record<Region, number> {
  const out = Object.fromEntries(REGIONS.map((r) => [r, 0])) as Record<Region, number>;
  for (const p of Object.values(w.players)) out[p.region] += 1;
  return out;
}

function fillStaff(w: World, rec: SeasonRecord, season: number): void {
  const teams = sortedTeams(w);
  // Staff intake: top the pool up to its target, roles in rotation, regions by team share.
  const regionTeams = REGIONS.map((r) => teams.filter((t) => t.region === r).length);
  const byRole = (role: StaffRole) => Object.values(w.staff).filter((s) => s.role === role);
  const perRoleTarget = Math.round(w.staffTarget / STAFF_ROLES.length);
  for (const role of STAFF_ROLES) {
    const have = byRole(role).length;
    for (let i = have; i < perRoleTarget; i++) {
      const id = nextId(w, "gs", season);
      const region = REGIONS[weightedIndex(streamFor(w.seed, `staff-region:${id}`), regionTeams)]!;
      const s = generateStaff({ seed: w.seed, id, region, role, season, calibration: w.calibration });
      w.staff[id] = s;
      rec.newStaff.push(id);
    }
  }
  // Vacancies: each team hires the best free staff member of the role (own region first).
  for (const t of teams) {
    for (const role of STAFF_ROLES) {
      if (t.staff[role] && w.staff[t.staff[role]!]) continue;
      const free = byRole(role).filter((s) => !s.teamId);
      if (free.length === 0) continue;
      free.sort((a, b) => Number(b.region === t.region) - Number(a.region === t.region) || staffQuality(b) - staffQuality(a) || a.staffId.localeCompare(b.staffId));
      const hire = free[0]!;
      hire.teamId = t.teamId;
      t.staff[role] = hire.staffId;
      rec.hires.push({ staffId: hire.staffId, teamId: t.teamId });
    }
  }
}

function intake(w: World, rec: SeasonRecord, season: number): void {
  const pop = regionPopulation(w);
  const reserved = new Set(w.reservedHandles);
  for (const region of REGIONS) {
    const target = w.regionTargets[region];
    const n = Math.max(Math.ceil(SEASON_MODEL.minIntakeShare * target), target - pop[region]);
    for (let i = 0; i < n; i++) {
      const id = nextId(w, "gp", season);
      const p = generatePlayer({ seed: w.seed, id, region, season, calibration: w.calibration, reserved });
      w.players[id] = p;
      rec.newPlayers.push(id);
    }
  }
  w.reservedHandles = [...reserved].sort();
}

/** Teams in a fair, season-rotating order (so the same team does not always pick first). */
function pickOrder(w: World, season: number): WorldTeam[] {
  const teams = sortedTeams(w);
  if (teams.length === 0) return teams;
  const k = season % teams.length;
  return [...teams.slice(k), ...teams.slice(0, k)];
}

function academies(w: World, rec: SeasonRecord, season: number): void {
  const sm = SEASON_MODEL;
  // Academy players who aged out are released.
  for (const t of sortedTeams(w)) {
    for (const id of t.academy.slice()) {
      const p = w.players[id];
      if (p && p.age > sm.academyMaxAge) {
        detachPlayer(w, p);
        rec.releases.push({ playerId: id, teamId: t.teamId });
      }
    }
  }
  // Rounds of picks: each team with a free place takes the prospect its scout rates highest (PA estimate).
  const prospects = rec.newPlayers.map((id) => w.players[id]!).filter((p) => p.status === "free");
  let picked = true;
  while (picked) {
    picked = false;
    for (const t of pickOrder(w, season)) {
      if (t.academy.length >= sm.academySize) continue;
      const scout = teamScout(w, t.teamId);
      const pool = prospects.filter((p) => p.status === "free" && p.region === t.region);
      if (pool.length === 0) continue;
      const scored = pool.map((p) => ({ p, pa: estimateAbility(w, scout, p).pa }));
      scored.sort((a, b) => b.pa - a.pa || a.p.playerId.localeCompare(b.p.playerId));
      const p = scored[0]!.p;
      p.teamId = t.teamId;
      p.status = "academy";
      t.academy.push(p.playerId);
      rec.academyPicks.push({ playerId: p.playerId, teamId: t.teamId });
      picked = true;
    }
  }
}

function squads(w: World, rec: SeasonRecord, season: number): void {
  const sm = SEASON_MODEL;
  const byAbility = (ids: string[]) => ids.slice().sort((a, b) => abilityOf(w.players[b]!) - abilityOf(w.players[a]!) || a.localeCompare(b));
  for (const t of pickOrder(w, season)) {
    const scout = teamScout(w, t.teamId);
    const est = (id: string) => estimateAbility(w, scout, w.players[id]!).ca;
    t.roster = byAbility(t.roster.filter((id) => w.players[id]));
    t.academy = t.academy.filter((id) => w.players[id]);
    // Promotion: an academy player the scout rates above the weakest starter (or a short roster).
    for (const id of t.academy.slice().sort((a, b) => est(b) - est(a) || a.localeCompare(b))) {
      const starters = t.roster.slice(0, sm.starters);
      const weakest = starters.length ? Math.min(...starters.map(est)) : -Infinity;
      if (starters.length < sm.starters || est(id) > weakest + sm.promotionMargin) {
        const p = w.players[id]!;
        t.academy = t.academy.filter((x) => x !== id);
        t.roster.push(id);
        p.status = "rostered";
        rec.signings.push({ playerId: id, teamId: t.teamId, from: "academy" });
        t.roster = t.roster.slice().sort((a, b) => est(b) - est(a) || a.localeCompare(b));
      }
    }
    // Short roster: sign the best free agents by the scout's estimate, own region first.
    while (t.roster.length < sm.starters) {
      const free = Object.values(w.players).filter((p) => p.status === "free");
      if (free.length === 0) break;
      const scored = free.map((p) => ({ p, home: p.region === t.region ? 1 : 0, ca: estimateAbility(w, scout, p).ca }));
      scored.sort((a, b) => b.home - a.home || b.ca - a.ca || a.p.playerId.localeCompare(b.p.playerId));
      const p = scored[0]!.p;
      p.teamId = t.teamId;
      p.status = "rostered";
      t.roster.push(p.playerId);
      rec.signings.push({ playerId: p.playerId, teamId: t.teamId, from: "free" });
    }
    // Oversized roster: release the weakest beyond the cap.
    t.roster = byAbility(t.roster);
    while (t.roster.length > sm.maxRoster) {
      const id = t.roster[t.roster.length - 1]!;
      detachPlayer(w, w.players[id]!);
      rec.releases.push({ playerId: id, teamId: t.teamId });
    }
  }
}

/** Steps 4–7: staff, intake, academies, squads; returns the new season's record. */
export function openSeason(w: World, season: number, rec: SeasonRecord = emptyRecord(w, season)): SeasonRecord {
  fillStaff(w, rec, season);
  intake(w, rec, season);
  academies(w, rec, season);
  squads(w, rec, season);
  const pop = regionPopulation(w);
  for (const r of REGIONS) rec.population[r] = pop[r];
  rec.population.staff = Object.keys(w.staff).length;
  return rec;
}

export interface AdvanceOptions {
  /** Training focus factors per player (club/training.ts seasonFocus); absent → F = 1. */
  readonly focus?: Readonly<Record<string, Partial<Record<AbilityKey, number>>>>;
}

/** End the current season and open the next. Returns a new World. */
export function advanceSeason(world: World, opts: AdvanceOptions = {}): World {
  const w = clone(world);
  const ending = w.season;
  const season = ending + 1;
  const rec = emptyRecord(w, season);

  // 1. development (from the season just played)
  const maps = new Map(Object.values(w.players).map((p) => [p.playerId, seasonMaps(w, p)]));
  for (const p of Object.values(w.players)) developPlayer(w, p, maps.get(p.playerId)!, coachDevelopment(w, p.teamId), ending, opts.focus?.[p.playerId]);
  for (const s of Object.values(w.staff)) developStaff(s);

  // 2. aging
  for (const p of Object.values(w.players)) p.age += 1;
  for (const s of Object.values(w.staff)) s.age += 1;

  // 3. retirement
  for (const p of Object.values(w.players).sort((a, b) => a.playerId.localeCompare(b.playerId))) {
    const u = streamFor(w.seed, `retire:${season}:${p.playerId}`)();
    if (u >= retirementHazard(w, p)) continue;
    detachPlayer(w, p);
    delete w.players[p.playerId];
    rec.retiredPlayers.push(p.playerId);
    w.retired.push({ id: p.playerId, kind: "player", label: p.handle ?? p.playerId, generated: p.generated, season, age: p.age });
  }
  for (const s of Object.values(w.staff).sort((a, b) => a.staffId.localeCompare(b.staffId))) {
    const u = streamFor(w.seed, `retire-staff:${season}:${s.staffId}`)();
    if (u >= staffRetirementHazard(s)) continue;
    if (s.teamId && w.teams[s.teamId]?.staff[s.role] === s.staffId) delete w.teams[s.teamId]!.staff[s.role];
    delete w.staff[s.staffId];
    rec.retiredStaff.push(s.staffId);
    w.retired.push({ id: s.staffId, kind: "staff", label: s.name, generated: s.generated, season, age: s.age });
  }

  // 4–7.
  w.season = season;
  openSeason(w, season, rec);
  w.history.push(rec);
  return w;
}
