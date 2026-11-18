# PROJECT V — Game Rules Data (`@pv/game-rules`)

> **Verification status: PROVISIONAL.** Every numeric value in this package currently
> ships with `verified: false`. The PV-3 (Simulation Core) agent did **not** perform live
> verification against Riot primary sources in this session. These are reasonable working
> defaults so the engine can be built and tested; they must be confirmed by the Data agent
> (PV-2) or a dedicated verification pass before any simulation *outcome* is trusted
> (README §19.1, §29; Handoff §10).

## 1. Why rules are data, not constants

VALORANT rule numbers change by patch, and historical matches must be interpreted under the
patch they were played on (Handoff §10). So each value is a `RuleValue<T>`:

```ts
interface RuleValue<T> {
  value: T;
  unit?: string;        // "credits" | "ms" | "points" | ...
  source: string;       // primary/secondary URL
  patch: string;        // e.g. "estimate:>=1.11" | "UNVERIFIED"
  verified: boolean;    // true only after confirmation against `source`
  note?: string;
}
```

Helpers: `provisional(value, source, opts)` builds an unverified value;
`requireVerified(rv, ctx)` throws if code tries to rely on an unverified number;
tests assert the whole table is currently unverified.

## 2. What is covered

| Module | Exports | Key values (provisional) |
|---|---|---|
| `economy.ts` | `ECONOMY_RULES`, `ARMOR_PURCHASES`, `lossBonusFor`, `canAfford`, `clampCredits` | start 800, max 9000, win 3000, loss ladder [1900, 2400, 2900], plant 300, kill 200 |
| `weapons.ts` | `WEAPON_PRICES`, `weaponPrice` | full sidearm/SMG/shotgun/rifle/sniper/LMG price table (Vandal/Phantom 2900, Operator 4700, …) |
| `rounds.ts` | `ROUND_RULES`, `isRegulationWin`, `isHalfBoundary` | buy 30s, round 100s, first-to-13, half at 12, OT win-by-2 |
| `spike.ts` | `SPIKE_RULES`, `canPlantWithin`, `canDefuseWithin` | plant 4s, defuse 7s (half 3.5s), detonation 45s |
| `ultimate.ts` | `ULTIMATE_POINT_RULES`, `ULTIMATE_COSTS`, `ultimatePointsRequired`, `isUltimateReady` | +1 per kill/plant/defuse/orb, 2 orbs/map, sample per-agent costs 7–8 |

## 3. Known unknowns (flagged `UNVERIFIED` in code)

These are called out explicitly because they are both uncertain and tactically important:

- **Spike plant reward** amount and recipients (economy.ts).
- **Regen shield** cost/points and availability (economy.ts).
- **Overtime** credits and exact format (rounds.ts) — has changed across patches.
- **Ultimate point on death** — whether dying grants a point has varied (ultimate.ts).
- **Non-hostile deaths** (spike detonation, fall): whether they charge enemy ult like a
  normal kill (README §21.4). Defaulted to `false`; confirm per patch. Do not invent
  self-harm actions that the game does not allow (README §21.4).

## 4. Sources to verify against

- Credits — https://wiki.playvalorant.com/en-us/Credits
- Loss-bonus rework — https://playvalorant.com/en-us/news/game-updates/valorant-patch-notes-1-11/
- Ultimate/abilities — https://wiki.playvalorant.com/en-us/Abilities , patch 1.0 notes
- Economy guide (secondary) — https://mobalytics.gg/blog/valorant/ultimate-economy-guide/
- Spike — https://wiki.playvalorant.com/en-us/Spike
- Canonical weapon/agent definitions & UUIDs — https://valorant-api.com/ (Data agent)

## 5. Verification workflow (for PV-2 / later pass)

1. Open the cited source for a value, confirm it for the **target patch**.
2. Update the `patch` string to the confirmed patch and set `verified: true`.
3. If the live value differs, change `value` and add a `note` with the old value + date.
4. Re-run `pnpm test`; the "every shipped rule value is unverified" assertion in
   `packages/game-rules/test/rules.test.ts` will fail once values flip — update it to track
   remaining unverified entries rather than asserting all-unverified.

## 6. Conventions

camelCase keys; durations in **ms**; credits as integers; `key`/`agentKey` are lowercase
slugs intended to map to valorant-api UUIDs catalogued by the Data agent in
`datasets/schema/`. Record any field-name/unit divergence from `datasets/schema/` as a
mapping in `docs/handoffs/PV-3-core.md`.
