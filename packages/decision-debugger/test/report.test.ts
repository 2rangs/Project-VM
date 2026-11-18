import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { analyzeDecisionContext, renderMarkdown, renderText, runCli } from "@pv/decision-debugger";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (s: string) => join(here, "fixtures", "scenarios", `scenario_${s}.json`);
const read = (s: string) => JSON.parse(readFileSync(fixture(s), "utf8"));

describe("Decision Debugger report (Handoff §21)", () => {
  it("renders a markdown report with all required sections", () => {
    const { trace } = analyzeDecisionContext(read("04"));
    const md = renderMarkdown(trace);
    expect(md).toContain("# Decision Debug");
    expect(md).toContain("## World State");
    expect(md).toContain("## Observed");
    expect(md).toContain("## Generated Actions");
    expect(md).toContain("## Validation — Excluded");
    expect(md).toContain("## Prediction");
    expect(md).toContain("## Selected Action");
    // The excluded B execute and its reason must be shown with real reasons.
    expect(md).toContain("B_EXECUTE");
    expect(md).toContain("insufficientTime");
  });

  it("surfaces the SYNTHETIC provenance so it is not mistaken for real data", () => {
    const { trace } = analyzeDecisionContext(read("01"));
    expect(renderMarkdown(trace)).toContain("SYNTHETIC");
    expect(renderText(trace)).toContain("SYNTHETIC");
  });

  it("report numbers come from the model's own evaluation (no invented values)", () => {
    const { trace, result } = analyzeDecisionContext(read("01"));
    const top = result.feasible[0]!;
    const md = renderMarkdown(trace);
    expect(md).toContain(top.id);
    expect(md).toContain(top.evaluation.expectedUtility.toFixed(3));
  });

  it("runCli produces a report for a scenario file path", () => {
    const out = runCli([fixture("05")]);
    expect(out).toContain("Decision Debug");
    expect(out).toContain("scenario-05");
  });

  it("runCli --text renders the plain-text variant and handles multiple files", () => {
    const out = runCli([fixture("01"), fixture("04"), "--text"]);
    expect(out).toContain("DECISION DEBUG");
    expect(out).toContain("scenario-01");
    expect(out).toContain("scenario-04");
  });

  it("runCli with no files prints usage", () => {
    expect(runCli([])).toContain("usage");
  });
});
