#!/usr/bin/env tsx
/**
 * Decision Debugger CLI (TASK 008).
 *
 * Usage:
 *   pnpm --filter @pv/decision-debugger debug <scenario.json> [more.json ...] [--format text|md]
 *
 * Reads one or more DecisionContext JSON files and prints a human-readable report of the
 * generated/excluded actions and the selected decision. Uses the Ascent placeholder
 * SpatialQuery until the real spatial-engine adapter is wired in.
 */
import { readFileSync } from "node:fs";
import { analyzeDecisionContext } from "./pipeline.js";
import { renderMarkdown, renderText } from "./report.js";

export function runCli(argv: readonly string[]): string {
  const files: string[] = [];
  let format: "md" | "text" = "md";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--format") {
      const v = argv[++i];
      format = v === "text" ? "text" : "md";
    } else if (a === "--text") {
      format = "text";
    } else {
      files.push(a);
    }
  }
  if (files.length === 0) {
    return "usage: pv-decision-debugger <scenario.json> [more.json ...] [--format text|md]";
  }
  const reports = files.map((file) => {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    const { trace } = analyzeDecisionContext(raw);
    return format === "text" ? renderText(trace) : renderMarkdown(trace);
  });
  return reports.join(format === "text" ? "\n\n" + "=".repeat(60) + "\n\n" : "\n\n---\n\n");
}

// Run when invoked directly (not when imported by tests).
const invokedDirectly =
  typeof process !== "undefined" && Array.isArray(process.argv) && /cli\.ts$/.test(process.argv[1] ?? "");
if (invokedDirectly) {
  process.stdout.write(runCli(process.argv.slice(2)) + "\n");
}
