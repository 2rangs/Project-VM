/**
 * Human-readable rendering of a {@link DecisionTrace} (Handoff §21).
 *
 * Markdown by default (tables for the prediction numbers); a plain-text variant is also
 * provided. The SYNTHETIC provenance is surfaced prominently so a report is never mistaken
 * for real match analysis (Handoff §31, README §19).
 */
import type { DecisionTrace } from "./trace.js";

const secs = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

export function renderMarkdown(t: DecisionTrace): string {
  const L: string[] = [];
  L.push(`# Decision Debug — ${t.contextId}${t.scenarioRef ? ` (${t.scenarioRef})` : ""}`);
  if (t.provenance.synthetic) {
    L.push("");
    L.push("> ⚠️ **SYNTHETIC scenario — not a real VCT match. Do not present as real data.**");
  }
  for (const n of t.provenance.notes) L.push(`> ${n}`);
  L.push("");
  L.push(`**Map:** ${t.mapId}  ·  **Round:** ${t.roundNumber}  ·  **Time left:** ${secs(t.timeRemainingMs)}`);

  L.push("", "## World State");
  L.push(`- Deciding team: \`${t.world.decidingTeamId}\` (${t.world.decidingSide})`);
  L.push(`- Attackers alive: ${t.world.attackersAlive}  ·  Defenders alive: ${t.world.defendersAlive}`);
  L.push(`- Known enemy alive (team belief): ${t.world.knownEnemyAliveCount ?? "unknown"}`);
  L.push(`- Spike: ${t.world.spikePhase}${t.world.spikeZone ? ` @ ${t.world.spikeZone}` : ""}`);

  L.push("", "## Observed (deciding team only — DECISION-004)");
  if (t.observed.visibleEnemies.length === 0) {
    L.push("- Visible enemies: none");
  } else {
    for (const e of t.observed.visibleEnemies) {
      L.push(`- ${e.playerId} @ ${e.zone} (${secs(e.msAgo)} ago${e.currentlyVisible ? ", visible now" : ""})`);
    }
  }
  if (t.observed.beliefTopZones.length > 0) {
    L.push(`- Top believed enemy zones: ${t.observed.beliefTopZones.map((z) => `${z.zone} ${z.pressure}`).join(", ")}`);
  }

  const byCat = (feasible: boolean) =>
    t.generated.filter((g) => g.feasible === feasible).reduce<Record<string, string[]>>((acc, g) => {
      (acc[g.category] ??= []).push(g.id);
      return acc;
    }, {});
  L.push("", `## Generated Actions (${t.generated.length})`);
  const feas = byCat(true);
  for (const cat of Object.keys(feas).sort()) L.push(`- **${cat}**: ${feas[cat]!.join(", ")}`);

  L.push("", `## Validation — Excluded (${t.excluded.length})`);
  if (t.excluded.length === 0) L.push("- none");
  for (const e of t.excluded) L.push(`- \`${e.id}\` — ${e.reasons.join(", ")}: ${e.explanation}`);

  L.push("", `## Prediction (feasible, top ${t.prediction.length})`);
  L.push("| Action | Category | Req. time | Risk | Utility |");
  L.push("|---|---|---:|---:|---:|");
  for (const p of t.prediction) {
    L.push(`| \`${p.id}\` | ${p.category} | ${p.requiredTimeMs}ms | ${p.estimatedRisk.toFixed(2)} | ${p.expectedUtility.toFixed(3)} |`);
  }

  L.push("", "## Selected Action");
  if (t.selected) {
    L.push(`**${t.selected.id}**`);
    L.push("");
    L.push(`Reason: ${t.selected.rationale}`);
  } else {
    L.push("_No feasible action._");
  }
  L.push("");
  return L.join("\n");
}

export function renderText(t: DecisionTrace): string {
  // A compact plain-text variant (no markdown tables).
  const L: string[] = [];
  L.push(`DECISION DEBUG — ${t.contextId}${t.scenarioRef ? ` (${t.scenarioRef})` : ""}`);
  if (t.provenance.synthetic) L.push("[SYNTHETIC — not real VCT data]");
  L.push(`Map ${t.mapId} | Round ${t.roundNumber} | Time ${secs(t.timeRemainingMs)}`);
  L.push(`Deciding ${t.world.decidingTeamId} (${t.world.decidingSide}) | A:${t.world.attackersAlive} D:${t.world.defendersAlive} | spike ${t.world.spikePhase}`);
  L.push(`Observed enemies: ${t.observed.visibleEnemies.map((e) => `${e.playerId}@${e.zone}`).join(", ") || "none"}`);
  L.push(`Generated: ${t.generated.length} (${t.generated.filter((g) => g.feasible).length} feasible, ${t.excluded.length} excluded)`);
  for (const e of t.excluded) L.push(`  EXCLUDED ${e.id} — ${e.reasons.join(",")}: ${e.explanation}`);
  L.push("Prediction:");
  for (const p of t.prediction) {
    L.push(`  ${p.id.padEnd(22)} time=${p.requiredTimeMs}ms risk=${p.estimatedRisk.toFixed(2)} util=${p.expectedUtility.toFixed(3)}`);
  }
  L.push(`Selected: ${t.selected ? t.selected.id : "none"}`);
  if (t.selected) L.push(`Reason: ${t.selected.rationale}`);
  return L.join("\n");
}
