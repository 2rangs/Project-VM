#!/usr/bin/env node
// Regenerate EXACT weapon stats from valorant-api into a GITIGNORED fixture.
//
// Per PV-1 docs/LICENSE_AUDIT.md, valorant-api-derived VALUES are not committed (license
// unclear) — they are regenerated locally. This writes test/fixtures/weapons.real.generated.json
// (gitignored). The committed tests use the hand-authored manual-approx fixture instead;
// point tests at this file only for higher-fidelity local experiments.
//
// Usage: node packages/combat-engine/scripts/fetch-real-weapons.mjs
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "..", "test", "fixtures", "weapons.real.generated.json");
const WANTED = ["Vandal", "Phantom", "Operator", "Sheriff", "Spectre", "Classic"];

const res = await fetch("https://valorant-api.com/v1/weapons");
if (!res.ok) throw new Error(`valorant-api ${res.status}`);
const body = await res.json();

const weapons = [];
for (const name of WANTED) {
  const w = body.data.find((x) => x.displayName === name);
  if (!w) {
    console.warn(`not found: ${name}`);
    continue;
  }
  const s = w.weaponStats ?? {};
  weapons.push({
    id: w.uuid,
    name: w.displayName,
    category: (w.shopData?.categoryText ?? w.category ?? "").toString(),
    cost: w.shopData?.cost ?? null,
    fireRate: s.fireRate ?? null,
    magazineSize: s.magazineSize ?? null,
    reloadTimeMs: s.reloadTimeSeconds != null ? Math.round(s.reloadTimeSeconds * 1000) : null,
    equipTimeMs: s.equipTimeSeconds != null ? Math.round(s.equipTimeSeconds * 1000) : null,
    runSpeedMultiplier: s.runSpeedMultiplier ?? null,
    damageBands: (s.damageRanges ?? []).map((r) => ({
      maxRangeMeters: r.rangeEndMeters,
      head: r.headDamage,
      body: r.bodyDamage,
      leg: r.legDamage,
    })),
    provenance: "valorant-api (regenerated locally; not committed)",
  });
}

writeFileSync(
  out,
  JSON.stringify(
    {
      _comment: "GITIGNORED. Regenerated from valorant-api; not committed (PV-1 LICENSE_AUDIT).",
      provenance: { sourceUrl: "https://valorant-api.com/v1/weapons", retrievedAt: new Date().toISOString(), evidenceType: "decoded" },
      weapons,
    },
    null,
    2,
  ) + "\n",
);
console.log(`Wrote ${out} (${weapons.length} weapons) — gitignored.`);
