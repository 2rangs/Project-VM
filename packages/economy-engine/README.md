# @pv/economy-engine

PROJECT V — Economy & Ultimate decision engine (v0). Pure, deterministic TypeScript. Turns an
economic situation into scored `EconomyOption[]` for the Action Generator (PV-3).

Full design, interface, and provenance: [`docs/ECONOMY_MODEL.md`](../../docs/ECONOMY_MODEL.md).

```ts
import { evaluateEconomy } from "@pv/economy-engine";

const opts = evaluateEconomy({
  phase: "save",
  context: {
    survivorWeaponKey: "operator", roundWinProb: 0.1, aliveOwn: 1, aliveEnemy: 4,
    roundNum: 13, matchScore: [6, 6], teamIdx: 0, consecutiveLosses: 0,
  },
});
// -> [{ action: "SAVE_WEAPON", currentRoundValue, futureValue, economicDelta, ultDelta, explanation }, ...]
```

```bash
npm install && npm run typecheck && npm test && npm run build
```

**Sources:** economy rule numbers mirror `@pv/game-rules` (provisional); ultimate point
requirements are the canonical PV-1 catalog; win-prob priors are PV-2's real
`datasets/derived/priors/`. `src/shared-mirror.ts` mirrors `@pv/shared-types` — swap for real
imports at monorepo integration.
