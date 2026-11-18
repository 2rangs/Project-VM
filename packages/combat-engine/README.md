# @project-v/combat-engine

PROJECT V combat resolution (v0). Resolves a duel as a **deterministic timeline of shots**
from physical and informational inputs — weapon stats, distance, cover/flash, who saw first
/ pre-aimed, shields, and player skills. The winner and time-to-kill are **emergent**, never
pre-decided (DECISION-002), and a higher skill rating cannot overcome an information deficit
(README §29 — no OVR-only combat).

Standalone package (own `package.json` / `tsconfig` / Vitest, no runtime deps).

## Model

- **Timeline** (`engine.ts`) — each side becomes ready to fire after a reaction delay
  (pre-aim ≈ instant; flash adds a long delay), then fires at its weapon's fire rate,
  reloading when empty. Shots are resolved earliest-first.
- **Per-shot rolls** (seeded, independent stream per combatant): hit vs miss from
  `hitChance` (weapon accuracy + range falloff + skill + moving/cover/flash), then location
  from `headshotChance`, then damage from the weapon's distance band.
- **Damage/armor** (`damage.ts`) — band lookup + 1:1 shield absorb (Operator body 150 kills
  through full heavy shield).
- **Skills** (`skills.ts`) — README §23.1 Mechanical ratings (aim, reaction, crosshair
  placement, first-bullet, tracking, movement, weapon control) mapped to timing and
  probabilities.
- **Monte Carlo** (`montecarlo.ts`) — win rates over N seeded duels.

All tuning numbers are in `params.ts` as **manual-approx**. `CombatCalibration` is the seam
to recalibrate against PV-2's real VCT stats (first-kill win rate, etc.) without touching the
engine.

## Weapon data & license

Per PV-1 `docs/LICENSE_AUDIT.md`, valorant-api-derived catalog **values are not committed**
(license unclear) — only schema + fixtures. So:

- Committed: `test/fixtures/weapons.manual-approx.json` — hand-authored approximations of
  publicly-documented weapon rules (Vandal, Phantom, Operator, Sheriff, Spectre, Classic),
  marked `manual-approx`. Used by the tests (offline, deterministic, license-safe).
- Regenerate exact, versioned values locally (gitignored):
  `npm run fetch-weapons` → `test/fixtures/weapons.real.generated.json`. Also available via
  PV-1's `tools/catalog-builder` (release-13.10).

## Usage

```ts
import { resolveDuel, monteCarloDuel, buildCatalog } from "@project-v/combat-engine";

const result = resolveDuel({ a, b, distanceMeters: 20 }, /*seed*/ 42);
// result.events: shot/hit/damage/kill log; result.winner / timeToKillMs / outcomes

const stats = monteCarloDuel({ a, b, distanceMeters: 42 }, 500, /*baseSeed*/ 1);
// stats.winRateA, avgTimeToKillMs
```

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (15 tests)
```
