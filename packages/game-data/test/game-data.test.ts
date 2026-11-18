// @pv/game-data tests. Run: node --experimental-strip-types --test test/*.test.ts
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getAbilityEffects, getAgent, getPlayer, getTeam, getWeapon, listAgents,
  listPlayers, listSimulatableTeams, listTeams, meta, normalizeAgentSlug,
} from "../src/index.ts";

test("meta counts match loaded collections", () => {
  const m = meta();
  assert.equal(listAgents().length, m.counts.agents);
  assert.equal(listPlayers().length, m.counts.players);
  assert.equal(listTeams().length, m.counts.teams);
  assert.ok(m.disclaimer.includes("re-reviewed before launch"));
});

test("agent slug aliases resolve (kayo/kay/o -> kay-o)", () => {
  assert.equal(normalizeAgentSlug("kayo"), "kay-o");
  assert.equal(normalizeAgentSlug("KAY/O"), "kay-o");
  assert.ok(getAgent("kayo"));
  assert.equal(getAgent("kayo")!.slug, "kay-o");
});

test("ability effects join by agent", () => {
  const sova = getAbilityEffects("sova");
  assert.equal(sova.length, 4); // 4 non-passive abilities
  assert.ok(sova.every((e) => e.abilityId.startsWith("sova:")));
});

test("weapons load (generated or manual-approx fallback)", () => {
  const vandal = getWeapon("vandal");
  assert.ok(vandal);
  assert.equal(vandal!.cost, 2900);
  assert.ok(["api", "manual-approx"].includes(vandal!.provenance));
});

test("rosters: every roster player exists in players; flags ratings", () => {
  for (const t of listSimulatableTeams()) {
    for (const r of t.roster) {
      const p = getPlayer(r.playerId);
      assert.ok(p, `roster player ${r.playerId} (team ${t.teamId}) missing from players.json`);
      assert.equal(typeof p!.hasRatings, "boolean"); // present-or-default is flagged, never fabricated
    }
  }
});

test("simulatable teams each have >=5 players (need 2 teams of 5 to sim)", () => {
  const sim = listSimulatableTeams();
  assert.ok(sim.length >= 2, "need at least two simulatable teams");
  for (const t of sim) assert.ok(t.roster.length >= 5, `${t.teamId} roster < 5`);
});

test("a matchup resolves to two full, named rosters", () => {
  const sim = listSimulatableTeams();
  const [a, b] = sim;
  const teamA = getTeam(a.teamId)!;
  const teamB = getTeam(b.teamId)!;
  assert.ok(teamA.roster.length >= 5 && teamB.roster.length >= 5);
  assert.ok(teamA.name && teamB.name);
});
