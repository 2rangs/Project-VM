# PROJECT V — ECONOMY & ULTIMATE MODEL

**Owner:** Data Engineering (PV-2) · **Date:** 2026-11-18 · **Package:** `packages/economy-engine` (v0)
**Specs:** Handoff §15–16, §20.7–20.10, §29; README §19–22, P3.

The economy engine turns an economic situation into **scored candidate options** that the Action
Generator (PV-3) consumes as Resource-Cost / Expected-Utility inputs (README §13.4, §15.1). It is a
pure, deterministic TypeScript library — same input → same output, no RNG, no I/O.

## The option contract
Every module returns `EconomyOption[]`. The Action Generator reads these fields:

```ts
interface EconomyOption {
  action: string;            // "fullBuy" | "SAVE_WEAPON" | "EXIT_KILL" | ...
  currentRoundValue: number; // [-1,1] effect on winning THIS round
  futureValue: number;       // [-1,1] effect on FUTURE rounds; 0 at no-future boundaries
  economicDelta: number;     // expected credits (own - enemy)
  ultDelta: number;          // expected ENEMY ult points DENIED (positive = good)
  explanation: string;       // grounded reason, for the Decision Debugger (§21, §29)
}
```
Dispatch: `evaluateEconomy({ phase: "buy"|"save"|"exitKill", context })`.

## Modules
| Module | Entry | Purpose |
|---|---|---|
| Buy strategy | `buyOptions(BuyContext)` | eco / half / force / full candidates, scored by the economy matchup prior |
| Future value | `projectNextRoundBank`, `weaponFutureValue`, `nextRoundWinEdge` | next 1–2 rounds' economy + win edge |
| Save decision | `saveOptions(SaveContext)` / `recommendSave` | SAVE_WEAPON vs PLAY_FOR_ROUND — **multi-factor, not a threshold** |
| Ultimate economy | `makeUltState`, `applyUltEvent`, `ultDenialValue` | track charge; value point-denial / readiness |
| Exit kill | `exitKillOptions(ExitKillContext)` | chase-for-weapon-destruction EV vs hold |
| Round boundaries | `isPreResetRound`, `isMapPoint`, `weaponPreservationHasFuture` | where "future value" is zero |

## Where the numbers come from
- **Economy rule constants** (prices, armor, loss-bonus ladder `[1900, 2400, 2900]`, rewards, ult
  point-earning): mirror of PV-core `@pv/game-rules`, all **provisional** (`verified: false`,
  pending a patch-source pass — README §29). Mirrored in `src/rules.ts`.
- **Ultimate point requirements**: the **canonical PV-1 catalog** (`pv-research:
  tools/catalog-builder/data/ability_facts.json`, `ultPoints`, build release-13.10,
  gameplayVerified). These override PV-core's small sample where they differ — **jett 8, sage 7,
  killjoy 9, brimstone 8** (PV-3 had 7/8/8/7).
- **Win-probability priors**: PV-2's **real** derived priors (`datasets/derived/priors/`, VCT
  Reference build 2026-11-12), copied into `src/priors-fixture.ts` as a snapshot. Key values:
  full>semi 0.66, semi>eco 0.91, **eco→next-round 0.598 vs full 0.506** (the snowball behind saving).

## Key design points (per the specs)
- **Saving is not a threshold (Handoff §29).** `SAVE_WEAPON` vs `PLAY_FOR_ROUND` compares weapon
  preservation value + ult-point denial + escape risk against the current-round win chance. A low win
  probability alone does **not** force a save: with a worthless weapon (Classic) and no ult to deny,
  playing scores at least as high (tested).
- **Future value vanishes at boundaries.** `weaponFutureValue` is 0 at the last round before a half /
  OT reset (round 12, 24, or any OT round — weapons don't carry) and at **match point** (the map can
  end, so there is no future round to save for). So at match point the engine prefers playing for the
  win over saving (Handoff §20.9, tested as scenario 09).
- **Ultimate point denial (Handoff §15.2, README §21.3).** `ultDenialValue` peaks when an enemy is
  exactly one point from a ready ult and is zero once they are already charged (the point is wasted).
  Surviving credits the SAVE option's `ultDelta`; dying while contesting debits `PLAY`'s `ultDelta`.
- **Exit kill (README §22).** Weighs destroying a fleeing enemy's high-value weapon against the risk
  of feeding your own rifle and the enemy's ult.

## Status / caveats
- **v0, provisional rule numbers.** Every economy constant is `verified:false` until a patch-source
  pass flips it. The engine exposes them via `Rule<T>` so that pass is mechanical.
- **Mirrored types.** `src/shared-mirror.ts` mirrors `@pv/shared-types`; replace with real imports at
  monorepo integration. `src/priors-fixture.ts` is a snapshot; load from `datasets/derived/priors/`
  at integration.
- **Not wired into a package graph yet** (standalone package.json/tsconfig/vitest). PV-3 can import
  `evaluateEconomy` and the typed contexts directly.

## Build & test
```bash
cd packages/economy-engine
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest: 15 tests (rules, scenarios 07/08/09, buy, future, exit kill, determinism)
npm run build       # emits dist/
```
