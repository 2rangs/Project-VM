# @project-v/ability-engine

PROJECT V ability runtime (v0). Deploys abilities as live **effect objects** and bridges
them into the spatial, perception and combat engines so a smoke actually blocks sight, a
flash actually delays a duel, recon actually reveals (a snapshot), and a molly actually
reshapes a path. Supports fakes via decoys (Handoff §14.2).

Standalone package; uses `@project-v/spatial-engine`, `@project-v/perception-engine`,
`@project-v/combat-engine` via `file:` links.

## Effect types

`smoke`, `wall` (destructible, blocks LoS), `flash`, `concuss`, `recon` (snapshot reveal),
`molly` (area denial), `slow`, `trap` (reveal on trigger), `decoy`. The vocabulary follows
PV-1's catalog `gameplay.typeTags` (`claude/pv-research`).

## Engine

`AbilityEngine` is stateful on an **increasing ms clock**:

- `use(spec, usage, opts)` → places an `ActiveEffect`, records flash blinds and reveal
  snapshots, emits `effectStart` / `flashApplied` / `reveal`.
- `advance(nowMs)` → expires timed effects (`effectExpire`) and clears elapsed blinds.
- `damageWall(id, dmg, nowMs)` → `effectDestroyed` when HP ≤ 0.
- `triggerTrap(id, enemies, nowMs)` → snapshot reveal.

## Adapters (integration)

- `toPerceptionAbilityStates(engine)` + `visionBlockerIsSmoke` → feed `world.activeAbilities`
  and `new SpatialPerceptionOracle(spatial, { isSmoke: visionBlockerIsSmoke })` so smokes
  AND walls block perception LoS.
- `combatFlashBlindMs(engine, playerId, nowMs)` → drop into a combat `EngagePosture.flashBlindMs`.
- `revealedEnemies(engine)` → frozen `RevealSnapshot[]` for the team picture. **Positions are
  captured at reveal time and never updated** — no omniscient leak (README §29).
- `deniedZoneIds(engine)` → pass as spatial `PathOptions.blockedZones` for molly area denial.

## Availability (PV-3 Constraint Validation)

`checkAvailability(catalog, loadoutEntry, nowMs, ult?)` returns `{ usable, reason }` across
charges / cooldown / ultimate points — called by PV-3's Action Generator in Constraint
Validation (README §15.3).

## Data & license

`test/fixtures/abilities.manual-approx.json` holds hand-authored approximations of public
ability behaviour (Ascent-meta agents), marked `manual-approx` — consistent with PV-1's
`LICENSE_AUDIT.md` (no valorant-api-derived values committed). Numbers defer to PV-1's
forthcoming ability-effect spec; divergences are tracked in `docs/handoffs/PV-4-spatial.md §C`.

## Develop

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest run (13 tests)
```
