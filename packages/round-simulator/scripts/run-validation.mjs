#!/usr/bin/env node
// Run N rounds and write a PV-2 sim-validation bundle (sim_run.json).
// Usage: vite-node scripts/run-validation.mjs <out.json> [rounds] [hitChanceScale]
//
// Optional hitChanceScale applies a symmetric CombatCalibration (combat-engine) — used to
// study whether symmetric calibration can move the attacker opening-duel rate (it cannot;
// see docs/research/FIRST_VALIDATION_RUN.md).
import { writeFileSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createEngine } from "@pv/spatial-engine";
import { buildCatalog } from "@pv/combat-engine";
import { RoundSimulator, ScriptedPolicy, makeSyntheticRound, SYNTHETIC_DEFENSE_ANCHORS, toValidationRun, SpatialQueryAdapter } from "../src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..", "..");
const nav = JSON.parse(readFileSync(resolve(root, "datasets/spatial/ascent/ascent.navgraph.json"), "utf8"));
const cs = JSON.parse(readFileSync(resolve(root, "datasets/spatial/ascent/coordinate-system.json"), "utf8"));
const spatial = createEngine(nav, cs.transform);
const sq = new SpatialQueryAdapter(spatial);
const weapons = buildCatalog(JSON.parse(readFileSync(resolve(here, "..", "test/fixtures/weapons.manual-approx.json"), "utf8")).weapons);

const out = process.argv[2] ?? "/tmp/sim_run.json";
const N = Number(process.argv[3] ?? 1000);
const hitChanceScale = process.argv[4] ? Number(process.argv[4]) : undefined;
const calibration = hitChanceScale != null ? { hitChanceScale } : undefined;

const results = [];
for (let i = 0; i < N; i++) {
  const sim = new RoundSimulator({
    spatial, weapons, abilities: {},
    policies: { attack: new ScriptedPolicy(sq, { attackSite: i % 2 === 0 ? "a-site" : "b-site" }), defense: new ScriptedPolicy(sq, { defenseAnchors: SYNTHETIC_DEFENSE_ANCHORS }) },
    config: { seed: 1000 + i, combatCalibration: calibration },
  });
  results.push(sim.runRound(makeSyntheticRound(spatial)));
}
const label = `scripted-ascent-${N}${calibration ? `-hc${hitChanceScale}` : ""}`;
writeFileSync(out, JSON.stringify(toValidationRun(results, label), null, 1));
const atkWins = results.filter((r) => r.winner === "attack").length;
console.log(`wrote ${out}: ${N} rounds, attack win rate ${(atkWins / N).toFixed(3)}`);
