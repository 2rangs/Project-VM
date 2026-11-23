// PROJECT V — report-only engine metrics for `sim:batch`.
//
// The 8 judged metrics (sim:validate / pv-validate-sim) compare aggregate round outcomes with VCT.
// These are NOT judged: they describe how the rounds were played — when the first kill happens,
// how often a side is wiped without a loss, how force buys fare, how long rounds last, how the
// attackers arrive on site, how varied their routes are, how often bodies overlap and how often
// the crowd rules (queue / give way / stack up) fire — plus the diagnostics recalibration needs
// (outcome mix by team-strength gap, post-plant play). Most have no VCT reference yet; where a
// public figure exists it is quoted in `reference` for orientation only.
//
// Input: match-runner RoundRecords (run with MatchConfig.collectStats for the positional ones) plus
// each round's attacker/defender strength (mean first-five combat skill). Output: a JSON-able
// object and a Markdown section appended to the sim:validate report.

import type { RoundRecord } from "../../../packages/match-runner/src/index.ts";

export interface RoundInput {
  readonly record: RoundRecord;
  /** Mean combat skill of the attacking / defending first five (0..1). */
  readonly attackStrength: number;
  readonly defenseStrength: number;
}

const sideOf = (id: string | undefined): "attack" | "defense" | null =>
  id?.startsWith("atk") ? "attack" : id?.startsWith("def") ? "defense" : null;

function quantile(xs: readonly number[], q: number): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
}
const mean = (xs: readonly number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const rate = (n: number, d: number): number | null => (d ? n / d : null);
const r3 = (x: number | null | undefined): number | null => (x == null || !Number.isFinite(x) ? null : Math.round(x * 1000) / 1000);
const dist = (xs: readonly number[]) => ({ n: xs.length, mean: r3(mean(xs)), p10: r3(quantile(xs, 0.1)), p50: r3(quantile(xs, 0.5)), p90: r3(quantile(xs, 0.9)), max: r3(xs.length ? Math.max(...xs) : null) });

/** Shannon entropy (bits) of a count table. */
function entropyBits(counts: ReadonlyMap<string, number>): number {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  let h = 0;
  for (const c of counts.values()) { const p = c / total; if (p > 0) h -= p * Math.log2(p); }
  return h;
}

export class EngineMetrics {
  private readonly rounds: RoundInput[] = [];

  add(r: RoundInput): void { this.rounds.push(r); }

  get size(): number { return this.rounds.length; }

  report() {
    const R = this.rounds;
    const firstKillS: number[] = [];
    let fkAttack = 0, fkRounds = 0, fkSideWon = 0;
    let flawless = 0;
    const durationS: number[] = [];
    const durationByReason: Record<string, number[]> = {};
    const tierRounds: Record<string, { n: number; atkWins: number }> = {};
    const forceVsFull = { n: 0, forceWins: 0 };
    const reasonMix: Record<string, number> = {};
    let planted = 0, plantedAtkWins = 0, defuseStarts = 0, defuseInterrupts = 0;
    const plantS: number[] = [];
    const postPlantDefAlive: number[] = [];
    // outcome by strength gap (attack minus defense, mean first-five combat skill)
    const gapBuckets = [-1, -0.06, -0.03, -0.01, 0.01, 0.03, 0.06, 1];
    const gapLabel = (i: number) => `${gapBuckets[i]!.toFixed(2)}..${gapBuckets[i + 1]!.toFixed(2)}`;
    const byGap = new Map<string, { n: number; atkWins: number; timeouts: number; defused: number; detonated: number; planted: number; elim: number }>();
    // positional (collectStats)
    let statRounds = 0, ticks = 0, overlapTicks = 0, overlapRounds = 0;
    const minPair: number[] = [];
    const arrivalSpreadS: number[] = [];
    const arrivalGapS: number[] = [];
    const firstArrivalS: Record<string, number[]> = {};
    let roundsReachedSite = 0;
    const routeCounts = new Map<string, number>();
    const leadRouteCounts = new Map<string, number>();
    const crowd = { queueTicks: 0, queuePushes: 0, yieldTicks: 0, yieldPushes: 0, stackWaits: 0, stackWaitTicks: 0, stackTimeouts: 0 };

    for (const { record: r, attackStrength, defenseStrength } of R) {
      const atk = r.attacker, def = atk === "A" ? "B" : "A";
      const end = r.events.find((e) => e.kind === "roundEnd");
      const durS = (end?.elapsedMs ?? 0) / 1000;
      durationS.push(durS);
      (durationByReason[r.reason] ??= []).push(durS);
      reasonMix[r.reason] = (reasonMix[r.reason] ?? 0) + 1;

      const kills = r.events.filter((e) => e.kind === "kill");
      const fk = kills[0];
      if (fk) {
        fkRounds++;
        firstKillS.push(fk.elapsedMs / 1000);
        const killerSide = sideOf(fk.actor) ?? (sideOf(fk.target) === "attack" ? "defense" : "attack");
        if (killerSide === "attack") fkAttack++;
        if (killerSide === r.winnerSide) fkSideWon++;
      }
      const winnerDeaths = kills.filter((k) => sideOf(k.target) === r.winnerSide).length;
      if (winnerDeaths === 0) flawless++;

      const tA = r.buys[atk].tier, tD = r.buys[def].tier;
      const key = `${tA}/${tD}`;
      const t = (tierRounds[key] ??= { n: 0, atkWins: 0 });
      t.n++; if (r.winnerSide === "attack") t.atkWins++;
      if ((tA === "force" && tD === "full") || (tA === "full" && tD === "force")) {
        forceVsFull.n++;
        const forceSide = tA === "force" ? "attack" : "defense";
        if (r.winnerSide === forceSide) forceVsFull.forceWins++;
      }

      const plantEv = r.events.find((e) => e.kind === "planted");
      if (plantEv) {
        planted++; if (r.winnerSide === "attack") plantedAtkWins++;
        plantS.push(plantEv.elapsedMs / 1000);
        const deadDefBefore = kills.filter((k) => k.elapsedMs <= plantEv.elapsedMs && sideOf(k.target) === "defense").length;
        postPlantDefAlive.push(5 - deadDefBefore);
      }
      defuseStarts += r.events.filter((e) => e.kind === "defuseStart").length;
      defuseInterrupts += r.events.filter((e) => e.kind === "defuseInterrupted").length;

      const gap = attackStrength - defenseStrength;
      let gi = gapBuckets.findIndex((b, i) => i < gapBuckets.length - 1 && gap >= b && gap < gapBuckets[i + 1]!);
      if (gi < 0) gi = gapBuckets.length - 2;
      const g = byGap.get(gapLabel(gi)) ?? { n: 0, atkWins: 0, timeouts: 0, defused: 0, detonated: 0, planted: 0, elim: 0 };
      g.n++; if (r.winnerSide === "attack") g.atkWins++;
      if (r.reason === "timeExpired") g.timeouts++;
      if (r.reason === "spikeDefused") g.defused++;
      if (r.reason === "spikeDetonation") g.detonated++;
      if (r.reason === "elimination") g.elim++;
      if (plantEv) g.planted++;
      byGap.set(gapLabel(gi), g);

      const s = r.stats;
      if (s) {
        statRounds++;
        ticks += s.ticks; overlapTicks += s.overlapTicks;
        if (s.overlapTicks > 0) overlapRounds++;
        if (Number.isFinite(s.minPairDistance)) minPair.push(s.minPairDistance);
        for (const k of Object.keys(crowd) as Array<keyof typeof crowd>) crowd[k] += s.crowd[k];
        const arr = s.siteArrivals;
        if (arr.length > 0) {
          roundsReachedSite++;
          const site = arr[0]!.zoneId;
          (firstArrivalS[site] ??= []).push(arr[0]!.atMs / 1000);
          const atSite = arr.filter((a) => a.zoneId === site).map((a) => a.atMs / 1000);
          if (atSite.length >= 2) {
            arrivalSpreadS.push(atSite[atSite.length - 1]! - atSite[0]!);
            for (let i = 1; i < atSite.length; i++) arrivalGapS.push(atSite[i]! - atSite[i - 1]!);
          }
          const lead = s.attackerRoutes[arr[0]!.playerId];
          if (lead) { const k = lead.join(">"); leadRouteCounts.set(k, (leadRouteCounts.get(k) ?? 0) + 1); }
        }
        for (const a of arr) {
          const route = s.attackerRoutes[a.playerId];
          if (route) { const k = route.join(">"); routeCounts.set(k, (routeCounts.get(k) ?? 0) + 1); }
        }
      }
    }

    const n = R.length;
    const topShare = (m: Map<string, number>) => {
      const tot = [...m.values()].reduce((a, b) => a + b, 0);
      const top = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      return top.map(([route, c]) => ({ route, share: r3(c / tot) }));
    };
    return {
      rounds: n,
      firstKill: {
        seconds: dist(firstKillS),
        within15sShare: r3(rate(firstKillS.filter((x) => x <= 15).length, firstKillS.length)),
        attackShare: r3(rate(fkAttack, fkRounds)),
        firstKillSideRoundWinRate: r3(rate(fkSideWon, fkRounds)),
        reference: "VCT: first-kill side wins ≈ 0.70–0.74 of rounds (public stat sites; not judged)",
      },
      flawlessShare: r3(rate(flawless, n)),
      roundDurationS: { all: dist(durationS), byReason: Object.fromEntries(Object.entries(durationByReason).map(([k, v]) => [k, dist(v)])) },
      reasonMix: Object.fromEntries(Object.entries(reasonMix).map(([k, v]) => [k, r3(v / n)])),
      buys: {
        attackWinRateByTiers: Object.fromEntries(Object.entries(tierRounds).sort().map(([k, v]) => [k, { n: v.n, attackWinRate: r3(v.atkWins / v.n) }])),
        forceVsFull: { n: forceVsFull.n, forceSideWinRate: r3(rate(forceVsFull.forceWins, forceVsFull.n)), reference: "VCT semi-buy vs full ≈ 0.32 (VALIDATION_BASELINES; tier definitions differ)" },
      },
      plant: {
        plantRate: r3(rate(planted, n)),
        postPlantAttackWinRate: r3(rate(plantedAtkWins, planted)),
        plantTimeS: dist(plantS),
        defendersAliveAtPlant: dist(postPlantDefAlive),
        defuseStartsPerPlant: r3(rate(defuseStarts, planted)),
        defuseInterruptsPerPlant: r3(rate(defuseInterrupts, planted)),
      },
      byStrengthGap: Object.fromEntries([...byGap.entries()].sort((a, b) => parseFloat(a[0]) - parseFloat(b[0])).map(([k, g]) => [k, {
        n: g.n, attackWinRate: r3(g.atkWins / g.n), plantRate: r3(g.planted / g.n),
        elimination: r3(g.elim / g.n), detonated: r3(g.detonated / g.n), defused: r3(g.defused / g.n), timeExpired: r3(g.timeouts / g.n),
      }])),
      movement: statRounds === 0 ? null : {
        rounds: statRounds,
        bodyOverlap: {
          tickShare: r3(overlapTicks / ticks), roundShare: r3(overlapRounds / statRounds),
          minPairDistanceUnits: dist(minPair), thresholdUnits: 30,
        },
        siteArrival: {
          roundsAttackReachedSite: r3(roundsReachedSite / statRounds),
          firstArrivalS: Object.fromEntries(Object.entries(firstArrivalS).map(([k, v]) => [k, dist(v)])),
          spreadFirstToLastS: dist(arrivalSpreadS),
          consecutiveGapS: dist(arrivalGapS),
        },
        pathDiversity: {
          distinctRoutesToSite: routeCounts.size,
          routeEntropyBits: r3(entropyBits(routeCounts)),
          distinctLeadRoutes: leadRouteCounts.size,
          leadRouteEntropyBits: r3(entropyBits(leadRouteCounts)),
          topLeadRoutes: topShare(leadRouteCounts),
        },
        crowdPerRound: Object.fromEntries(Object.entries(crowd).map(([k, v]) => [k, r3(v / statRounds)])),
      },
    };
  }
}

export type EngineMetricsReport = ReturnType<EngineMetrics["report"]>;

/** Markdown rendering (appended to the sim:validate report as a report-only section). */
export function renderEngineMetrics(m: EngineMetricsReport): string {
  const L: string[] = [];
  const f = (x: unknown) => (x == null ? "—" : typeof x === "number" ? String(x) : String(x));
  const d = (x: { n: number; mean: number | null; p10: number | null; p50: number | null; p90: number | null; max: number | null }) =>
    `n ${x.n} · mean ${f(x.mean)} · p10 ${f(x.p10)} · p50 ${f(x.p50)} · p90 ${f(x.p90)} · max ${f(x.max)}`;
  L.push("", "## Engine metrics (report-only, not judged)", "");
  L.push(`Rounds: ${m.rounds}`, "");
  L.push("| Metric | Value |", "|---|---|");
  L.push(`| First kill time (s) | ${d(m.firstKill.seconds)} |`);
  L.push(`| First kill ≤ 15 s | ${f(m.firstKill.within15sShare)} |`);
  L.push(`| First kill by attack | ${f(m.firstKill.attackShare)} |`);
  L.push(`| First-kill side wins round | ${f(m.firstKill.firstKillSideRoundWinRate)} |`);
  L.push(`| Flawless rounds (winner lost nobody) | ${f(m.flawlessShare)} |`);
  L.push(`| Round duration (s) | ${d(m.roundDurationS.all)} |`);
  for (const [k, v] of Object.entries(m.roundDurationS.byReason)) L.push(`| Duration — ${k} (s) | ${d(v)} |`);
  L.push(`| Force vs full: force side wins | ${f(m.buys.forceVsFull.forceSideWinRate)} (n ${m.buys.forceVsFull.n}) |`);
  L.push(`| Plant rate · post-plant attack win | ${f(m.plant.plantRate)} · ${f(m.plant.postPlantAttackWinRate)} |`);
  L.push(`| Plant time (s) | ${d(m.plant.plantTimeS)} |`);
  L.push(`| Defenders alive at plant | ${d(m.plant.defendersAliveAtPlant)} |`);
  L.push(`| Defuse starts / interrupts per plant | ${f(m.plant.defuseStartsPerPlant)} / ${f(m.plant.defuseInterruptsPerPlant)} |`);
  if (m.movement) {
    const mv = m.movement;
    L.push(`| Body overlap (<30 uu) — tick share · round share | ${f(mv.bodyOverlap.tickShare)} · ${f(mv.bodyOverlap.roundShare)} |`);
    L.push(`| Min pair distance per round (uu) | ${d(mv.bodyOverlap.minPairDistanceUnits)} |`);
    L.push(`| Attack reached a site | ${f(mv.siteArrival.roundsAttackReachedSite)} |`);
    for (const [k, v] of Object.entries(mv.siteArrival.firstArrivalS)) L.push(`| First arrival ${k} (s) | ${d(v)} |`);
    L.push(`| Site arrival spread first→last (s) | ${d(mv.siteArrival.spreadFirstToLastS)} |`);
    L.push(`| Site arrival consecutive gap (s) | ${d(mv.siteArrival.consecutiveGapS)} |`);
    L.push(`| Routes to site: distinct · entropy (bits) | ${mv.pathDiversity.distinctRoutesToSite} · ${f(mv.pathDiversity.routeEntropyBits)} |`);
    L.push(`| Lead routes: distinct · entropy (bits) | ${mv.pathDiversity.distinctLeadRoutes} · ${f(mv.pathDiversity.leadRouteEntropyBits)} |`);
    for (const [k, v] of Object.entries(mv.crowdPerRound)) L.push(`| Crowd per round — ${k} | ${f(v)} |`);
  }
  L.push("", "Reason mix: " + Object.entries(m.reasonMix).map(([k, v]) => `${k} ${v}`).join(" · "), "");
  L.push("### Attack win rate by buy tiers (attack/defense)", "", "| Tiers | n | Attack win |", "|---|---|---|");
  for (const [k, v] of Object.entries(m.buys.attackWinRateByTiers)) L.push(`| ${k} | ${v.n} | ${f(v.attackWinRate)} |`);
  L.push("", "### Outcome by team-strength gap (attack − defense, mean first-five combat skill)", "",
    "| Gap | n | Attack win | Plant | Elim | Detonated | Defused | Time out |", "|---|---|---|---|---|---|---|---|");
  for (const [k, v] of Object.entries(m.byStrengthGap)) L.push(`| ${k} | ${v.n} | ${f(v.attackWinRate)} | ${f(v.plantRate)} | ${f(v.elimination)} | ${f(v.detonated)} | ${f(v.defused)} | ${f(v.timeExpired)} |`);
  if (m.movement) {
    L.push("", "### Most common lead routes (first attacker on site)", "");
    for (const t of m.movement.pathDiversity.topLeadRoutes) L.push(`- ${t.share} — ${t.route}`);
  }
  return L.join("\n") + "\n";
}
