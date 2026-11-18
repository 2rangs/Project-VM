/**
 * Round-level team decision report (Handoff §21, extended to the team layer).
 * Renders a TeamRoundTrace as Markdown: IGL strategy (and any mid-round change), role
 * assignments, and each player's chosen command with the candidates they weighed.
 */
import type { TeamRoundTrace } from "./policy.js";

export function renderRoundReport(t: TeamRoundTrace): string {
  const L: string[] = [];
  L.push(`# Team Decision — ${t.contextId}${t.scenarioRef ? ` (${t.scenarioRef})` : ""}`);
  L.push("");
  L.push(`**Team:** \`${t.teamId}\` (${t.side})`);
  L.push(
    `**Strategy:** ${t.openingStrategy}` +
      (t.reconsidered ? ` → **${t.finalStrategy}** (re-decided: ${t.reconsiderReason})` : ` (held)`),
  );
  L.push(
    `**Generation:** ${t.generation.feasibleCount} feasible, ${t.generation.excludedCount} excluded` +
      (t.generation.selected ? `, team-selected \`${t.generation.selected}\`` : ""),
  );

  L.push("", "## Roles");
  for (const r of t.roles) L.push(`- \`${String(r.playerId)}\` → ${r.role}`);

  L.push("", "## Player commands");
  L.push("| Player | Role | Command | Considered (id:weight) |");
  L.push("|---|---|---|---|");
  for (const p of t.players) {
    const cmd = t.decision.commands.find((c) => String(c.playerId) === p.playerId);
    const cmdStr = cmd
      ? `${cmd.kind}${cmd.targetZone ? ` → ${cmd.targetZone}` : ""}${cmd.executeAtMs != null ? ` @${cmd.executeAtMs}ms` : ""}`
      : "—";
    const considered = p.considered.map((c) => `${c.id}:${c.weight}`).join(", ");
    L.push(`| \`${p.playerId}\` | ${p.role} | ${cmdStr} | ${considered} |`);
  }
  L.push("");
  return L.join("\n");
}
