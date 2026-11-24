// PROJECT V — the regular measurement suite: planning, headline extraction and comparison.
//
// Pure functions (no I/O, no clock) so they can be unit-tested; measure-suite.mts is the runner.
//
// A suite is a fixed list of sim:batch runs, executed one at a time:
//   default      the default batch                         (N matches, seeds 1..N, Ascent)
//   seed161      the same on unseen seeds                  (N matches, seeds 161..160+N)
//   abilities    agent abilities on                        (N matches, seeds 1..N)
//   map-<id>     each map on its OWN geometry              (M matches each, every map in the registry)
// Every batch writes to its own files under <outDir>/<runId>/, so nothing is overwritten:
//   <batch>.run.json  (SimRun bundle)   <batch>.json / .md  (sim:validate report)   <batch>.engine.json   <batch>.log

export interface SuiteOptions {
  /** Matches for the three Ascent batches (default 160). */
  readonly matches: number;
  /** Matches per map for the own-geometry batches (default 60). */
  readonly mapMatches: number;
  /** Maps for the own-geometry batches: { id, displayName }. */
  readonly maps: ReadonlyArray<{ readonly id: string; readonly displayName: string }>;
  /** Restrict the suite to these batch ids (default: all). */
  readonly only?: readonly string[];
  /** Python interpreter handed to every batch (default: the batch's own resolution). */
  readonly python?: string;
}

export interface SuiteBatch {
  readonly id: string;
  readonly label: string;
  readonly matches: number;
  /** sim:batch arguments, without --out / --report. */
  readonly args: readonly string[];
}

export const DEFAULT_MATCHES = 160;
export const DEFAULT_MAP_MATCHES = 60;
/** The second seed range starts here whatever the match count, so it never overlaps the default 160. */
export const UNSEEN_SEED_START = 161;

/** The batches of a suite, in the order they run. */
export function planSuite(o: SuiteOptions): SuiteBatch[] {
  const py = o.python ? ["--python", o.python] : [];
  const n = String(o.matches);
  const all: SuiteBatch[] = [
    { id: "default", label: `default — ${o.matches} matches, seeds 1..${o.matches}, Ascent`, matches: o.matches, args: ["--matches", n, "--seed-start", "1", ...py] },
    { id: "seed161", label: `unseen seeds — ${o.matches} matches, seeds ${UNSEEN_SEED_START}..${UNSEEN_SEED_START + o.matches - 1}, Ascent`, matches: o.matches, args: ["--matches", n, "--seed-start", String(UNSEEN_SEED_START), ...py] },
    { id: "abilities", label: `abilities on — ${o.matches} matches, seeds 1..${o.matches}, Ascent`, matches: o.matches, args: ["--matches", n, "--seed-start", "1", "--abilities", ...py] },
    ...o.maps.map((m): SuiteBatch => ({
      id: `map-${m.id}`, label: `${m.displayName} on its own geometry — ${o.mapMatches} matches, seeds 1..${o.mapMatches}`, matches: o.mapMatches,
      args: ["--matches", String(o.mapMatches), "--seed-start", "1", "--map", m.displayName, "--geometry", "own", ...py],
    })),
  ];
  if (!o.only || o.only.length === 0) return all;
  const unknown = o.only.filter((id) => !all.some((b) => b.id === id));
  if (unknown.length > 0) throw new Error(`unknown batch id(s): ${unknown.join(", ")} (known: ${all.map((b) => b.id).join(", ")})`);
  return all.filter((b) => o.only!.includes(b.id));
}

/** The files one batch writes. `out` (the bundle) and `report` (the report prefix) never collide. */
export function batchPaths(runDir: string, batchId: string): { out: string; report: string; log: string } {
  return { out: `${runDir}/${batchId}.run.json`, report: `${runDir}/${batchId}`, log: `${runDir}/${batchId}.log` };
}

/**
 * The command line that runs one batch. With a lock script it is
 *     <lock> "<label>" -- npx tsx <sim-batch> <args> --out <bundle> --report <prefix>
 * so the batch waits for its turn behind every other heavy job on the machine.
 */
export function batchCommand(batch: SuiteBatch, runDir: string, simBatchScript: string, lock: string | null, runLabel: string): string[] {
  const p = batchPaths(runDir, batch.id);
  const cmd = ["npx", "tsx", simBatchScript, ...batch.args, "--out", p.out, "--report", p.report];
  return lock ? [lock, `suite ${runLabel}: ${batch.id}`, "--", ...cmd] : cmd;
}

// ---- headline metrics ----------------------------------------------------------------------

export interface ReportMetric {
  readonly metric: string;
  readonly dims?: Readonly<Record<string, unknown>>;
  readonly simValue: number | null;
  readonly simN?: number;
  readonly realRate?: number | null;
  readonly passed?: boolean | null;
  readonly unit?: string;
}

export interface Headline {
  readonly key: string;
  readonly label: string;
  readonly judged: boolean;
  readonly metric: string;
  readonly dims: Readonly<Record<string, string | number>>;
}

/** The metrics the suite table shows, in column order. Everything else stays in the per-batch report. */
export const HEADLINES: readonly Headline[] = [
  { key: "attackWin", label: "Attack win", judged: true, metric: "side_winrate", dims: { side: "attack", phase: "all" } },
  { key: "elimination", label: "Elimination", judged: true, metric: "round_outcome_distribution", dims: { outcome: "elimination" } },
  { key: "defuse", label: "Defuse", judged: true, metric: "round_outcome_distribution", dims: { outcome: "defuse" } },
  { key: "detonation", label: "Detonation", judged: true, metric: "round_outcome_distribution", dims: { outcome: "bomb_detonated" } },
  { key: "timeExpired", label: "Time expired", judged: true, metric: "round_outcome_distribution", dims: { outcome: "time_expired" } },
  { key: "openingDuel", label: "Atk opening duel", judged: true, metric: "opening_duel", dims: { side: "attack" } },
  { key: "pistol", label: "Pistol v pistol", judged: true, metric: "economy_matchup", dims: { ownBuy: "pistol", oppBuy: "pistol" } },
  { key: "fullFull", label: "Full v full", judged: true, metric: "economy_matchup", dims: { ownBuy: "full", oppBuy: "full" } },
  { key: "firstKillP50", label: "First kill p50", judged: false, metric: "first_kill_time_s", dims: { stat: "p50" } },
  { key: "flawless", label: "Flawless", judged: false, metric: "flawless_rounds", dims: {} },
  { key: "forceVsFull", label: "Force v full", judged: false, metric: "economy", dims: { metric: "force_vs_full_win" } },
  { key: "durationP50", label: "Round p50", judged: false, metric: "round_duration_s", dims: { stat: "p50" } },
  { key: "plantRate", label: "Plant rate", judged: false, metric: "post_plant", dims: { measure: "plant_rate" } },
  { key: "postPlantWin", label: "Post-plant atk win", judged: false, metric: "post_plant", dims: { measure: "post_plant_attack_win" } },
  { key: "plantToEndP50", label: "Plant→end p50", judged: false, metric: "plant_to_end_s", dims: { stat: "p50" } },
  { key: "trade3s", label: "Trades ≤3 s", judged: false, metric: "trade_rate_3s", dims: {} },
  { key: "clutchAny", label: "Clutch wins/round", judged: false, metric: "clutch_wins_per_round", dims: { x: "any" } },
  { key: "kast", label: "KAST", judged: false, metric: "kast", dims: { side: "all" } },
  { key: "duelistShare", label: "Duelist kill share", judged: false, metric: "role_kill_share", dims: { role: "duelist" } },
  { key: "arrivalSpreadP50", label: "Site arrival spread p50", judged: false, metric: "site_arrival_spread_s", dims: { span: "first_to_last", stat: "p50" } },
  { key: "leadRouteEntropy", label: "Lead-route entropy", judged: false, metric: "route_diversity", dims: { routes: "lead", stat: "entropy" } },
  { key: "bodyOverlap", label: "Body overlap (ticks)", judged: false, metric: "body_overlap", dims: { share: "ticks" } },
];

export interface HeadlineValue {
  readonly value: number | null;
  readonly unit: string;
  readonly real: number | null;
  readonly passed: boolean | null;
  readonly n: number | null;
}

function dimsMatch(have: Readonly<Record<string, unknown>> | undefined, want: Readonly<Record<string, string | number>>): boolean {
  const h = have ?? {};
  const keys = Object.keys(want);
  if (keys.length === 0) return Object.keys(h).filter((k) => k !== "window_ms").length === 0;
  return keys.every((k) => String(h[k]) === String(want[k])) && Object.keys(h).every((k) => k in want);
}

/** Pick the headline values out of one sim:validate report (`metrics` array). Missing rows give nulls. */
export function headlineValues(metrics: readonly ReportMetric[]): Record<string, HeadlineValue> {
  const out: Record<string, HeadlineValue> = {};
  for (const h of HEADLINES) {
    const m = metrics.find((r) => r.metric === h.metric && dimsMatch(r.dims, h.dims));
    out[h.key] = m
      ? { value: m.simValue ?? null, unit: m.unit ?? "rate", real: m.realRate ?? null, passed: m.passed ?? null, n: m.simN ?? null }
      : { value: null, unit: "rate", real: null, passed: null, n: null };
  }
  return out;
}

// ---- comparison ------------------------------------------------------------------------------

export interface BatchResult {
  readonly id: string;
  readonly label: string;
  /** "ok": the batch ran and was validated (judged metrics may still fail) · "error": it did not finish. */
  readonly status: "ok" | "error" | "skipped";
  readonly exitCode: number | null;
  readonly seconds: number | null;
  readonly matches: number;
  readonly rounds: number | null;
  readonly judged: { readonly passed: number; readonly judged: number } | null;
  readonly headlines: Record<string, HeadlineValue>;
  readonly error?: string;
}

export interface SuiteRun {
  readonly runId: string;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly commit: string | null;
  readonly dirty: boolean | null;
  readonly config: { readonly matches: number; readonly mapMatches: number };
  readonly batches: readonly BatchResult[];
}

export interface ComparisonRow {
  readonly batch: string;
  readonly key: string;
  readonly label: string;
  readonly judged: boolean;
  readonly unit: string;
  readonly previous: number | null;
  readonly now: number | null;
  readonly delta: number | null;
  readonly real: number | null;
  readonly passed: boolean | null;
  readonly previousPassed: boolean | null;
}

/** One row per (batch, headline): the value now, the value in the previous run, and the change. */
export function compareRuns(now: SuiteRun, previous: SuiteRun | null): ComparisonRow[] {
  const rows: ComparisonRow[] = [];
  for (const b of now.batches) {
    const pb = previous?.batches.find((x) => x.id === b.id && x.status === "ok") ?? null;
    for (const h of HEADLINES) {
      const cur = b.headlines[h.key];
      const prev = pb?.headlines[h.key] ?? null;
      const n = cur?.value ?? null;
      const p = prev?.value ?? null;
      rows.push({
        batch: b.id, key: h.key, label: h.label, judged: h.judged, unit: cur?.unit ?? "rate",
        previous: p, now: n, delta: n != null && p != null ? n - p : null,
        real: cur?.real ?? null, passed: cur?.passed ?? null, previousPassed: prev?.passed ?? null,
      });
    }
  }
  return rows;
}

/**
 * Whether two runs measured the same thing: same match counts, so their numbers are comparable.
 * (A two-match dry run must never become the baseline of a full run, or the other way round.)
 */
export function comparable(a: SuiteRun, b: SuiteRun): boolean {
  return a.config.matches === b.config.matches && a.config.mapMatches === b.config.mapMatches;
}

/** The most recent earlier run that is comparable with `now` (by finish time), or null. */
export function pickPrevious(now: SuiteRun, candidates: readonly SuiteRun[]): SuiteRun | null {
  const earlier = candidates
    .filter((r) => r.runId !== now.runId && comparable(now, r) && r.finishedAt <= now.startedAt)
    .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : -1));
  return earlier[0] ?? null;
}

export function fmt(v: number | null, unit = "rate", signed = false): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = signed && v >= 0 ? "+" : "";
  if (unit === "s") return `${s}${v.toFixed(1)}s`;
  if (unit === "ms") return `${s}${v.toFixed(0)}ms`;
  if (unit === "bits") return `${s}${v.toFixed(2)}`;
  if (unit === "count") return `${s}${v.toFixed(0)}`;
  return `${s}${v.toFixed(3)}`;
}

/** The suite report: one table of every batch against the previous run, judged metrics first. */
export function renderSuiteMarkdown(now: SuiteRun, previous: SuiteRun | null): string {
  const rows = compareRuns(now, previous);
  const L: string[] = [];
  L.push("# PROJECT V — measurement suite", "");
  L.push(`- Run \`${now.runId}\` · ${now.startedAt} → ${now.finishedAt} · commit \`${now.commit ?? "?"}\`${now.dirty ? " (working tree dirty)" : ""}`);
  L.push(`- ${now.config.matches} matches per Ascent batch, ${now.config.mapMatches} per own-geometry map batch; batches ran one at a time.`);
  L.push(previous
    ? `- Compared with run \`${previous.runId}\` (${previous.finishedAt}, commit \`${previous.commit ?? "?"}\`). Each cell: value now, then the change since that run in brackets.`
    : "- No earlier comparable run (same match counts) to compare with: the change columns are empty.");
  L.push("- ✅ / ❌ mark judged metrics (pass / fail against the VCT baseline); everything else is report-only.", "");

  L.push("## Batches", "", "| Batch | What | Status | Rounds | Judged pass | Was | Time |", "|---|---|---|---|---|---|---|");
  for (const b of now.batches) {
    const pb = previous?.batches.find((x) => x.id === b.id) ?? null;
    const j = b.judged ? `${b.judged.passed}/${b.judged.judged}` : "—";
    const pj = pb?.judged ? `${pb.judged.passed}/${pb.judged.judged}` : "—";
    L.push(`| ${b.id} | ${b.label} | ${b.status === "ok" ? "ran" : b.status === "skipped" ? "skipped" : `**failed** — ${b.error ?? `exit ${b.exitCode}`}`} | ${b.rounds ?? "—"} | ${j} | ${pj} | ${b.seconds != null ? `${Math.round(b.seconds)}s` : "—"} |`);
  }

  const table = (title: string, judged: boolean) => {
    const heads = HEADLINES.filter((h) => h.judged === judged);
    L.push("", `## ${title}`, "", `| Batch | ${heads.map((h) => h.label).join(" | ")} |`, `|---|${heads.map(() => "---").join("|")}|`);
    const first = now.batches.find((b) => b.status === "ok");
    if (first) {
      const real = heads.map((h) => fmt(first.headlines[h.key]?.real ?? null, first.headlines[h.key]?.unit));
      if (real.some((x) => x !== "—")) L.push(`| *VCT (${first.id})* | ${real.join(" | ")} |`);
    }
    for (const b of now.batches) {
      if (b.status !== "ok") { L.push(`| ${b.id} | ${heads.map(() => "—").join(" | ")} |`); continue; }
      const cells = heads.map((h) => {
        const r = rows.find((x) => x.batch === b.id && x.key === h.key)!;
        const mark = r.passed == null ? "" : r.passed ? " ✅" : " ❌";
        const d = r.delta == null ? "" : ` (${fmt(r.delta, r.unit, true)})`;
        return `${fmt(r.now, r.unit)}${d}${mark}`;
      });
      L.push(`| ${b.id} | ${cells.join(" | ")} |`);
    }
  };
  table("Judged metrics", true);
  table("Report-only metrics", false);

  const flips = rows.filter((r) => r.passed != null && r.previousPassed != null && r.passed !== r.previousPassed);
  if (flips.length > 0) {
    L.push("", "## Judged metrics that changed verdict", "");
    for (const r of flips) L.push(`- ${r.batch} · ${r.label}: ${r.previousPassed ? "pass → **fail**" : "fail → **pass**"} (${fmt(r.previous, r.unit)} → ${fmt(r.now, r.unit)}, VCT ${fmt(r.real, r.unit)})`);
  }
  L.push("", "Per-batch detail: `<batch>.md` (every metric, with its VCT reference and notes), `<batch>.engine.json`, `<batch>.log`. All rows as data: `comparison.csv`.");
  return L.join("\n") + "\n";
}

/** The comparison as CSV (every batch × headline), for spreadsheets and diffs. */
export function renderComparisonCsv(now: SuiteRun, previous: SuiteRun | null): string {
  const q = (v: unknown) => (v == null ? "" : String(v));
  const lines = ["batch,metric,label,judged,unit,previous,now,delta,vct,result"];
  for (const r of compareRuns(now, previous)) {
    lines.push([r.batch, r.key, `"${r.label}"`, r.judged, r.unit, q(r.previous), q(r.now), q(r.delta), q(r.real), r.passed == null ? "" : r.passed ? "pass" : "fail"].join(","));
  }
  return lines.join("\n") + "\n";
}
