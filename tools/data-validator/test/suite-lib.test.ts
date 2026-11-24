import { describe, it, expect } from "vitest";
import {
  HEADLINES, batchCommand, batchPaths, comparable, compareRuns, fmt, headlineValues, pickPrevious, planSuite,
  renderComparisonCsv, renderSuiteMarkdown, type BatchResult, type ReportMetric, type SuiteRun,
} from "../scripts/suite-lib.mts";

const MAPS = [{ id: "ascent", displayName: "Ascent" }, { id: "haven", displayName: "Haven" }];

describe("planSuite — what the regular suite runs", () => {
  const plan = planSuite({ matches: 160, mapMatches: 60, maps: MAPS });

  it("default, unseen seeds, abilities on, then every map on its own geometry", () => {
    expect(plan.map((b) => b.id)).toEqual(["default", "seed161", "abilities", "map-ascent", "map-haven"]);
    expect(plan[0]!.args).toEqual(["--matches", "160", "--seed-start", "1"]);
    expect(plan[1]!.args).toEqual(["--matches", "160", "--seed-start", "161"]);
    expect(plan[2]!.args).toContain("--abilities");
    expect(plan[4]!.args).toEqual(["--matches", "60", "--seed-start", "1", "--map", "Haven", "--geometry", "own"]);
  });

  it("the unseen-seed batch starts at 161 whatever the match count (never overlaps the default 160)", () => {
    const small = planSuite({ matches: 2, mapMatches: 1, maps: [] });
    expect(small[1]!.args).toEqual(["--matches", "2", "--seed-start", "161"]);
  });

  it("--only restricts the batches and rejects unknown ids", () => {
    expect(planSuite({ matches: 4, mapMatches: 2, maps: MAPS, only: ["map-haven", "default"] }).map((b) => b.id)).toEqual(["default", "map-haven"]);
    expect(() => planSuite({ matches: 4, mapMatches: 2, maps: MAPS, only: ["map-atlantis"] })).toThrow(/unknown batch id/);
  });

  it("an explicit Python interpreter reaches every batch", () => {
    for (const b of planSuite({ matches: 4, mapMatches: 2, maps: MAPS, python: "/venv/bin/python" })) {
      expect(b.args.slice(-2)).toEqual(["--python", "/venv/bin/python"]);
    }
  });
});

describe("batch commands — one at a time, through the lock, to distinct files", () => {
  const plan = planSuite({ matches: 160, mapMatches: 60, maps: MAPS });

  it("every batch is wrapped in the lock script with a label naming the run and the batch", () => {
    for (const b of plan) {
      const cmd = batchCommand(b, "reports/suite/r1", "sim-batch.mts", "/tools/heavy-run.sh", "r1");
      expect(cmd.slice(0, 3)).toEqual(["/tools/heavy-run.sh", `suite r1: ${b.id}`, "--"]);
      expect(cmd.slice(3, 6)).toEqual(["npx", "tsx", "sim-batch.mts"]);
    }
  });

  it("without a lock the command is the bare batch", () => {
    expect(batchCommand(plan[0]!, "d", "sim-batch.mts", null, "r")[0]).toBe("npx");
  });

  it("no two files of a run collide: bundle, report, engine metrics and log are all distinct", () => {
    const files = plan.flatMap((b) => {
      const p = batchPaths("reports/suite/r1", b.id);
      return [p.out, `${p.report}.json`, `${p.report}.md`, `${p.report}.engine.json`, p.log];
    });
    expect(new Set(files).size).toBe(files.length);
    const p = batchPaths("d", "default");
    const cmd = batchCommand(plan[0]!, "d", "s", null, "r");
    expect(cmd[cmd.indexOf("--out") + 1]).toBe(p.out);
    expect(cmd[cmd.indexOf("--report") + 1]).toBe(p.report);
  });
});

const metric = (m: string, dims: Record<string, unknown>, simValue: number | null, extra: Partial<ReportMetric> = {}): ReportMetric =>
  ({ metric: m, dims, simValue, simN: 100, realRate: null, passed: null, unit: "rate", ...extra });

describe("headlineValues — picking the suite's columns out of a report", () => {
  const metrics: ReportMetric[] = [
    metric("side_winrate", { side: "attack", phase: "all" }, 0.52, { realRate: 0.509, passed: true }),
    metric("round_outcome_distribution", { outcome: "defuse" }, 0.11, { realRate: 0.16, passed: false }),
    metric("round_duration_s", { stat: "p50" }, 41.2, { unit: "s" }),
    metric("round_duration_s", { stat: "p50", outcome: "defuse" }, 60.0, { unit: "s" }),
    metric("flawless_rounds", {}, 0.21),
    metric("trade_rate_3s", { window_ms: 3000 }, 0.33),
    metric("economy", { metric: "force_vs_full_win" }, 0.2, { realRate: 0.32 }),
    metric("economy", { metric: "plan_win", plan: "force" }, 0.9),
    metric("route_diversity", { routes: "lead", stat: "entropy" }, 2.4, { unit: "bits" }),
  ];
  const h = headlineValues(metrics);

  it("matches a row by metric and by its exact dims", () => {
    expect(h["attackWin"]).toMatchObject({ value: 0.52, real: 0.509, passed: true });
    expect(h["defuse"]).toMatchObject({ value: 0.11, passed: false });
    expect(h["durationP50"]).toMatchObject({ value: 41.2, unit: "s" }); // not the per-outcome row
    expect(h["flawless"]!.value).toBe(0.21);
    expect(h["trade3s"]!.value).toBe(0.33);
    expect(h["forceVsFull"]).toMatchObject({ value: 0.2, real: 0.32 });
    expect(h["leadRouteEntropy"]).toMatchObject({ value: 2.4, unit: "bits" });
  });

  it("a metric the report does not have is null, never a guess", () => {
    expect(h["kast"]).toEqual({ value: null, unit: "rate", real: null, passed: null, n: null });
    expect(Object.keys(h).sort()).toEqual(HEADLINES.map((x) => x.key).sort());
  });

  it("the headline list covers every metric the work package asked for", () => {
    const have = new Set(HEADLINES.map((x) => x.metric));
    for (const m of ["first_kill_time_s", "flawless_rounds", "economy", "round_duration_s", "plant_to_end_s", "site_arrival_spread_s",
      "route_diversity", "body_overlap", "trade_rate_3s", "clutch_wins_per_round", "post_plant", "kast", "role_kill_share"]) {
      expect(have.has(m), m).toBe(true);
    }
  });
});

const batch = (id: string, attackWin: number | null, over: Partial<BatchResult> = {}): BatchResult => ({
  id, label: id, status: "ok", exitCode: 1, seconds: 100, matches: 160, rounds: 3400, judged: { passed: 7, judged: 8 },
  headlines: headlineValues(attackWin == null ? [] : [metric("side_winrate", { side: "attack", phase: "all" }, attackWin, { realRate: 0.509, passed: Math.abs(attackWin - 0.509) <= 0.04 })]),
  ...over,
});
const run = (runId: string, startedAt: string, batches: BatchResult[], config = { matches: 160, mapMatches: 60 }): SuiteRun =>
  ({ runId, startedAt, finishedAt: startedAt.replace("T10", "T11"), commit: "abc1234", dirty: false, config, batches });

describe("comparison against the previous run", () => {
  const prev = run("r1", "2026-11-20T10:00:00.000Z", [batch("default", 0.56), batch("abilities", 0.7)]);
  const now = run("r2", "2026-11-24T10:00:00.000Z", [batch("default", 0.52), batch("seed161", 0.5), batch("map-haven", null, { status: "error", error: "exit 1 — boom", judged: null })]);

  it("each row carries the value now, the previous value and the change", () => {
    const rows = compareRuns(now, prev);
    const d = rows.find((r) => r.batch === "default" && r.key === "attackWin")!;
    expect(d.previous).toBe(0.56);
    expect(d.now).toBe(0.52);
    expect(d.delta).toBeCloseTo(-0.04, 10);
    expect(d.passed).toBe(true);
    expect(d.previousPassed).toBe(false);
  });

  it("a batch that is new, or a first run, has no previous value — and no invented delta", () => {
    const fresh = compareRuns(now, prev).find((r) => r.batch === "seed161" && r.key === "attackWin")!;
    expect(fresh.previous).toBeNull();
    expect(fresh.delta).toBeNull();
    expect(compareRuns(now, null).every((r) => r.previous === null && r.delta === null)).toBe(true);
  });

  it("only runs with the same match counts are comparable; the latest earlier one is picked", () => {
    const dry = run("dry", "2026-11-23T10:00:00.000Z", [batch("default", 0.9)], { matches: 2, mapMatches: 1 });
    const older = run("r0", "2026-11-10T10:00:00.000Z", [batch("default", 0.6)]);
    const later = run("r3", "2026-11-25T10:00:00.000Z", [batch("default", 0.5)]);
    expect(comparable(now, dry)).toBe(false);
    expect(pickPrevious(now, [older, dry, prev, later, now])!.runId).toBe("r1");
    expect(pickPrevious(dry, [older, prev])).toBeNull();
  });

  it("the Markdown table shows value, change and verdict, and lists verdict flips and failed batches", () => {
    const md = renderSuiteMarkdown(now, prev);
    expect(md).toContain("Compared with run `r1`");
    expect(md).toMatch(/\| default \| 0\.520 \(-0\.040\) ✅ \|/);
    expect(md).toMatch(/\| seed161 \| 0\.500 ✅ \|/); // no previous → no bracket
    expect(md).toContain("**failed** — exit 1 — boom");
    expect(md).toContain("default · Attack win: fail → **pass** (0.560 → 0.520, VCT 0.509)");
    expect(md).toContain("| *VCT (default)* | 0.509 |");
    expect(renderSuiteMarkdown(now, null)).toContain("No earlier comparable run");
  });

  it("the CSV has one row per batch and headline", () => {
    const csv = renderComparisonCsv(now, prev).trim().split("\n");
    expect(csv[0]).toBe("batch,metric,label,judged,unit,previous,now,delta,vct,result");
    expect(csv.length).toBe(1 + now.batches.length * HEADLINES.length);
    expect(csv.find((l) => l.startsWith("default,attackWin,"))).toContain(",0.56,0.52,");
  });
});

describe("fmt", () => {
  it("renders by unit, signs changes, and shows a dash for a missing value", () => {
    expect(fmt(0.5123)).toBe("0.512");
    expect(fmt(-0.04, "rate", true)).toBe("-0.040");
    expect(fmt(0.04, "rate", true)).toBe("+0.040");
    expect(fmt(41.26, "s")).toBe("41.3s");
    expect(fmt(2.345, "bits")).toBe("2.35");
    expect(fmt(7, "count")).toBe("7");
    expect(fmt(null)).toBe("—");
  });
});
