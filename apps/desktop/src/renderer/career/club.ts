// Club operations for the desktop: the user's club, and the rows the Finance / Transfers /
// Training screens show. Pure (no React) so node:test can load it. Everything a screen shows of
// another club's player comes through the user's scout (ranges), never the true CA/PA.
import {
  playerValue, scoutedAbility, seasonFocus, suggestedTerms, wageBill, windowStatus,
  exposureShares, CLUB_MODEL,
  type Contract, type IndivFocus, type OfferKind, type TransferOffer, type World, type WorldPlayer,
} from './world.ts';

export { clubSeasonEnd } from './world.ts';

// The manager's club is the career's (start menu → new career); the club layer starts with the
// career (career mode's built-in club hook) and runs on its calendar.
export const userTeamId = (w: World): string | null => w.club?.userTeamId ?? null;

export interface FinanceSummary {
  balance: number;
  wageBudget: number;
  transferBudget: number;
  wageBill: number;
  playerWages: number;
  staffWages: number;
  sponsorship: number;
  expectedIncome: number;
  fanbase: number;
  seasonIncome: number;
  seasonCosts: number;
  overBudget: boolean;
}

export function financeSummary(w: World): FinanceSummary | null {
  const id = userTeamId(w);
  const f = id ? w.club!.finances[id] : undefined;
  if (!id || !f) return null;
  const bill = wageBill(w, id);
  const vals = Object.values(f.season);
  return {
    balance: f.balance, wageBudget: f.wageBudget, transferBudget: f.transferBudget, wageBill: bill.total,
    playerWages: bill.players, staffWages: bill.staff, sponsorship: f.sponsorship, expectedIncome: f.expectedIncome, fanbase: f.fanbase,
    seasonIncome: vals.filter((v) => (v ?? 0) > 0).reduce((s, v) => s + (v ?? 0), 0),
    seasonCosts: -vals.filter((v) => (v ?? 0) < 0).reduce((s, v) => s + (v ?? 0), 0),
    overBudget: bill.total > f.wageBudget * (1 + CLUB_MODEL.wageTolerance),
  };
}

export interface WageRow { id: string; name: string; kind: 'player' | 'staff'; role: string; salary: number; endSeason: number; buyout: number | null; squadRole: Contract['squadRole'] }

/** Everyone the user's club pays, highest salary first. */
export function wageRows(w: World): WageRow[] {
  const id = userTeamId(w);
  if (!id) return [];
  return Object.values(w.club!.contracts).filter((c) => c.teamId === id).map((c) => {
    const p = c.kind === 'player' ? w.players[c.personId] : undefined;
    const s = c.kind === 'staff' ? w.staff[c.personId] : undefined;
    return {
      id: c.personId, kind: c.kind, name: p ? p.handle ?? p.playerId : s?.name ?? c.personId,
      role: p ? p.role ?? '—' : s?.role ?? '—', salary: c.salary, endSeason: c.endSeason, buyout: c.buyout, squadRole: c.squadRole,
    };
  }).sort((a, b) => b.salary - a.salary || a.id.localeCompare(b.id));
}

export interface SearchFilters {
  role?: string;
  maxAge?: number;
  /** Minimum scouted CA (1–200 scale, the estimate's centre). */
  minCa?: number;
  maxFee?: number;
  freeOnly?: boolean;
  /** Only players of the user club's region (default true: regional leagues). */
  ownRegion?: boolean;
  shortlistOnly?: boolean;
}

export interface SearchRow {
  player: WorldPlayer;
  playerId: string;
  handle: string;
  age: number;
  role: string;
  teamName: string | null;
  ca: number; caLo: number; caHi: number;
  pa: number; paLo: number; paHi: number;
  /** The user scout's value of the player (0 for free agents: no fee). */
  value: number;
  contractEnd: number | null;
  shortlisted: boolean;
}

export function searchRows(w: World, f: SearchFilters = {}): SearchRow[] {
  const uid = userTeamId(w);
  const region = uid ? w.teams[uid]?.region : undefined;
  const short = new Set(w.club?.shortlist ?? []);
  const out: SearchRow[] = [];
  for (const p of Object.values(w.players)) {
    if (!p.hasRatings || p.teamId === uid || p.status === 'academy') continue;
    if ((f.ownRegion ?? true) && region && p.region !== region) continue;
    if (f.freeOnly && p.teamId) continue;
    if (f.role && p.role !== f.role) continue;
    if (f.maxAge !== undefined && p.age > f.maxAge) continue;
    if (f.shortlistOnly && !short.has(p.playerId)) continue;
    const e = scoutedAbility(w, uid, p);
    if (f.minCa !== undefined && e.ca < f.minCa) continue;
    const value = p.teamId ? playerValue(w, p, uid) : 0;
    if (f.maxFee !== undefined && value > f.maxFee) continue;
    out.push({
      player: p, playerId: p.playerId, handle: p.handle ?? `#${p.playerId}`, age: p.age, role: p.role ?? '—',
      teamName: p.teamId ? w.teams[p.teamId]?.name ?? p.teamId : null, ...e, value,
      contractEnd: w.club?.contracts[p.playerId]?.endSeason ?? null, shortlisted: short.has(p.playerId),
    });
  }
  return out.sort((a, b) => b.ca - a.ca || a.playerId.localeCompare(b.playerId));
}

export function toggleShortlist(w: World, playerId: string): World {
  const n = structuredClone(w);
  const s = n.club!.shortlist;
  n.club!.shortlist = s.includes(playerId) ? s.filter((x) => x !== playerId) : [...s, playerId];
  return n;
}

/** The offer kind that fits a player for the user's club. */
export function offerKindFor(w: World, p: WorldPlayer): OfferKind {
  const uid = userTeamId(w);
  if (p.teamId && p.teamId === uid) return 'renewal';
  return p.teamId ? 'transfer' : 'free';
}

export function defaultTerms(w: World, p: WorldPlayer, kind: OfferKind) {
  return suggestedTerms(w, p.playerId, userTeamId(w)!, kind);
}

export function outgoingOffers(w: World): TransferOffer[] {
  const uid = userTeamId(w);
  return (w.club?.offers ?? []).filter((o) => o.toTeamId === uid).slice().reverse();
}

export function incomingOffers(w: World): TransferOffer[] {
  const uid = userTeamId(w);
  return (w.club?.offers ?? []).filter((o) => o.fromTeamId === uid && o.toTeamId !== uid).slice().reverse();
}

export function windowInfo(w: World) {
  return windowStatus(w.club?.date ?? `${w.season}-01-01`);
}

export interface TrainingRow { player: WorldPlayer; playerId: string; handle: string; role: string; age: number; focus: IndivFocus; fatigue: number; shares: { mechanics: number; utility: number; teamplay: number } | null; factors: Record<string, number> | null }

export function trainingRows(w: World): TrainingRow[] {
  const uid = userTeamId(w);
  if (!uid) return [];
  const t = w.teams[uid]!;
  const plan = w.club!.training.plans[uid];
  const focus = seasonFocus(w);
  return [...t.roster, ...t.academy].map((id) => w.players[id]).filter((p): p is WorldPlayer => !!p).map((p) => {
    const e = w.club!.training.exposure[p.playerId];
    return {
      player: p, playerId: p.playerId, handle: p.handle ?? p.playerId, role: p.role ?? '—', age: p.age,
      focus: plan?.individual[p.playerId] ?? 'balanced', fatigue: e?.fatigue ?? CLUB_MODEL.fatigueStart,
      shares: exposureShares(e), factors: (focus[p.playerId] as Record<string, number> | undefined) ?? null,
    };
  });
}

/** USD for the UI: $1.25M / $340K / $900. */
export function usd(v: number): string {
  const sign = v < 0 ? '-' : '';
  const a = Math.abs(v);
  if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(2)}M`;
  if (a >= 1_000) return `${sign}$${Math.round(a / 1_000)}K`;
  return `${sign}$${Math.round(a)}`;
}
